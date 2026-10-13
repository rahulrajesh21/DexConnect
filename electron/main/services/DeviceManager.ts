import { EventEmitter } from 'node:events';
import type { IAdbExecutor, DeviceRawRecord } from '../adapters/IAdbExecutor';
import type {
  DeviceInfo,
  DeviceState,
  DeviceBrand,
  ConnectionType,
  BatteryInfo,
} from '../../../src/types';

/**
 * Options configuring the DeviceManager polling and caching behavior.
 */
export interface DeviceManagerOptions {
  /**
   * Base polling interval in milliseconds.
   * Default: 2000 (2 seconds)
   */
  pollIntervalMs?: number;

  /**
   * Minimum time before refreshing battery metrics for an authorized device.
   * Default: 10000 (10 seconds)
   */
  batteryRefreshIntervalMs?: number;

  /**
   * Whether to automatically start polling upon instantiation.
   * Default: false
   */
  autoStart?: boolean;

  /**
   * Maximum backoff delay on consecutive ADB errors.
   * Default: 10000 (10 seconds)
   */
  maxBackoffMs?: number;
}

/**
 * Internal cache entry for a connected device's static properties.
 */
interface CachedDeviceProperties {
  serial: string;
  brand: DeviceBrand;
  manufacturer: string;
  model: string;
  androidVersion: string;
  connectionType: ConnectionType;
  ipAddress?: string;
  port?: number;
  loaded: boolean;
}

interface DeviceCacheEntry {
  staticProps: CachedDeviceProperties;
  battery: BatteryInfo;
  lastBatteryFetch: number;
}

/**
 * Helper: Detect device brand from manufacturer string.
 * Normalizes to 'samsung' | 'motorola' | 'generic'.
 */
export function detectBrand(manufacturer: string): DeviceBrand {
  const lower = (manufacturer || '').toLowerCase().trim();
  if (lower.includes('samsung')) return 'samsung';
  if (lower.includes('motorola') || lower.includes('lenovo')) return 'motorola';
  return 'generic';
}

/**
 * Helper: Detect connection type from serial string.
 * Serials containing ':' are TCP/IP Wi-Fi connections.
 */
export function detectConnectionType(serial: string): ConnectionType {
  return serial.includes(':') ? 'wifi' : 'usb';
}

/**
 * Helper: Parse IP address and port from serial.
 */
export function parseSerialAddress(serial: string): { ip?: string; port?: number } {
  const match = serial.match(/^([^:]+):(\d+)$/);
  if (match) {
    const port = parseInt(match[2], 10);
    if (!Number.isNaN(port)) {
      return {
        ip: match[1],
        port,
      };
    }
  }
  return {};
}

/**
 * Helper: Deep equality for BatteryInfo.
 */
export function isBatteryEqual(a: BatteryInfo, b: BatteryInfo): boolean {
  if (!a || !b) return a === b;
  return (
    a.level === b.level &&
    a.scale === b.scale &&
    a.status === b.status &&
    a.isCharging === b.isCharging &&
    a.powerSource === b.powerSource
  );
}

/**
 * Helper: Deep equality for DeviceInfo.
 */
export function isDeviceEqual(a: DeviceInfo, b: DeviceInfo): boolean {
  if (!a || !b) return a === b;
  return (
    a.serial === b.serial &&
    a.state === b.state &&
    a.brand === b.brand &&
    a.manufacturer === b.manufacturer &&
    a.model === b.model &&
    a.androidVersion === b.androidVersion &&
    a.connectionType === b.connectionType &&
    a.ipAddress === b.ipAddress &&
    a.port === b.port &&
    isBatteryEqual(a.battery, b.battery)
  );
}

/**
 * Helper: Deep equality for DeviceInfo arrays.
 */
export function areDeviceListsEqual(prevList: DeviceInfo[], currList: DeviceInfo[]): boolean {
  if (prevList.length !== currList.length) return false;
  const prevMap = new Map<string, DeviceInfo>();
  for (const d of prevList) {
    prevMap.set(d.serial, d);
  }
  for (const curr of currList) {
    const prev = prevMap.get(curr.serial);
    if (!prev) return false;
    if (!isDeviceEqual(prev, curr)) return false;
  }
  return true;
}

/**
 * DeviceManager supervises attached ADB devices, maintains static property caches,
 * throttles battery queries, and emits diff updates to IPC.
 */
export class DeviceManager extends EventEmitter {
  private readonly adb: IAdbExecutor;
  private readonly pollIntervalMs: number;
  private readonly batteryRefreshIntervalMs: number;
  private readonly maxBackoffMs: number;

  private isRunning = false;
  private pollingPromise: Promise<DeviceInfo[]> | null = null;
  private consecutiveErrors = 0;
  private timerId: NodeJS.Timeout | null = null;

  private cache: Map<string, DeviceCacheEntry> = new Map();
  private currentDevices: DeviceInfo[] = [];

  constructor(adb: IAdbExecutor, options: DeviceManagerOptions = {}) {
    super();
    this.adb = adb;
    this.pollIntervalMs = options.pollIntervalMs ?? 2000;
    this.batteryRefreshIntervalMs = options.batteryRefreshIntervalMs ?? 10000;
    this.maxBackoffMs = options.maxBackoffMs ?? 10000;

    if (options.autoStart) {
      this.start();
    }
  }

  /**
   * Starts the adaptive polling loop.
   */
  public start(): void {
    if (this.isRunning) return;
    this.isRunning = true;
    this.consecutiveErrors = 0;
    void this.pollTick(false);
  }

  /**
   * Stops the polling loop and cancels any pending timers.
   */
  public stop(): void {
    this.isRunning = false;
    if (this.timerId !== null) {
      clearTimeout(this.timerId);
      this.timerId = null;
    }
  }

  /**
   * Disposes the manager, clearing timers, caches, and event listeners.
   */
  public dispose(): void {
    this.stop();
    this.removeAllListeners();
    this.cache.clear();
    this.currentDevices = [];
  }

  /**
   * Checks whether the polling engine is active.
   */
  public isStarted(): boolean {
    return this.isRunning;
  }

  /**
   * Returns the count of cached device entries.
   */
  public getCacheSize(): number {
    return this.cache.size;
  }

  /**
   * Returns the currently cached snapshot of devices.
   */
  public getDevices(): DeviceInfo[] {
    return this.currentDevices.map((d) => ({
      ...d,
      battery: { ...d.battery },
    }));
  }

  /**
   * Returns a specific device by serial.
   */
  public getDeviceBySerial(serial: string): DeviceInfo | undefined {
    const dev = this.currentDevices.find((d) => d.serial === serial);
    if (!dev) return undefined;
    return {
      ...dev,
      battery: { ...dev.battery },
    };
  }

  /**
   * Triggers an immediate poll tick. If forceBattery is true, ignores battery throttling.
   */
  public async refresh(forceBattery = false): Promise<DeviceInfo[]> {
    return this.pollTick(forceBattery, true);
  }

  /**
   * Single poll tick execution with re-entrancy protection.
   */
  private async pollTick(forceBattery: boolean, isManual = false): Promise<DeviceInfo[]> {
    if (!this.isRunning && !forceBattery && !isManual) {
      return this.getDevices();
    }

    if (this.pollingPromise) {
      return this.pollingPromise;
    }

    this.pollingPromise = this.executePoll(forceBattery, isManual);
    try {
      return await this.pollingPromise;
    } finally {
      this.pollingPromise = null;
      this.scheduleNextTick();
    }
  }

  /**
   * Executes a single poll operation against the ADB adapter.
   */
  private async executePoll(forceBattery: boolean, isManual: boolean): Promise<DeviceInfo[]> {
    try {
      const rawRecords = await this.adb.getDevices();
      const now = Date.now();
      const updatedDevices: DeviceInfo[] = [];
      const activeSerials = new Set<string>();

      for (const raw of rawRecords) {
        activeSerials.add(raw.serial);
        const devInfo = await this.resolveDeviceInfo(raw, now, forceBattery);
        updatedDevices.push(devInfo);
      }

      // Evict disconnected devices from property cache
      for (const serial of this.cache.keys()) {
        if (!activeSerials.has(serial)) {
          this.cache.delete(serial);
        }
      }

      // Identify newly attached and detached devices
      const prevSerials = new Set(this.currentDevices.map((d) => d.serial));
      const newlyAttached = updatedDevices.filter((d) => !prevSerials.has(d.serial));
      const newlyDetached = this.currentDevices.filter((d) => !activeSerials.has(d.serial));

      // Diffing algorithm: only emit when list, connection state, or battery changes
      const hasChanged = !areDeviceListsEqual(this.currentDevices, updatedDevices);
      if (hasChanged && (this.isRunning || forceBattery || isManual)) {
        this.currentDevices = updatedDevices;

        for (const dev of newlyAttached) {
          this.emit('device-attached', { ...dev, battery: { ...dev.battery } });
        }
        for (const dev of newlyDetached) {
          this.emit('device-detached', { ...dev, battery: { ...dev.battery } });
        }

        this.emit('devices-updated', this.getDevices());
      }

      this.consecutiveErrors = 0;
    } catch (err: unknown) {
      this.consecutiveErrors++;
      this.emit('error', err);
    }

    return this.getDevices();
  }

  /**
   * Resolves device info by combining cached static props with fresh/throttled ADB queries.
   */
  private async resolveDeviceInfo(
    raw: DeviceRawRecord,
    now: number,
    forceBattery: boolean
  ): Promise<DeviceInfo> {
    const isWifi = detectConnectionType(raw.serial) === 'wifi';
    const addressInfo = isWifi ? parseSerialAddress(raw.serial) : {};
    const state: DeviceState =
      raw.state === 'device' ? 'device' : raw.state === 'offline' ? 'offline' : 'unauthorized';

    // Fallback battery info for degraded states or query failures
    const defaultBattery: BatteryInfo = {
      level: 100,
      scale: 100,
      status: 1,
      isCharging: false,
      powerSource: isWifi ? 'battery' : 'usb',
    };

    // If device is not authorized or offline, skip shell property and battery commands
    if (state !== 'device') {
      this.cache.delete(raw.serial);
      return {
        serial: raw.serial,
        state,
        brand: 'generic',
        manufacturer: 'unknown',
        model: raw.model || raw.serial,
        androidVersion: 'unknown',
        connectionType: isWifi ? 'wifi' : 'usb',
        ipAddress: addressInfo.ip,
        port: addressInfo.port,
        battery: defaultBattery,
      };
    }

    let entry = this.cache.get(raw.serial);

    // 1. Fetch static properties if not yet cached or loaded
    if (!entry || !entry.staticProps.loaded) {
      const [mfgResult, mdlResult, verResult, battResult] = await Promise.allSettled([
        this.adb.getProp(raw.serial, 'ro.product.manufacturer'),
        this.adb.getProp(raw.serial, 'ro.product.model'),
        this.adb.getProp(raw.serial, 'ro.build.version.release'),
        this.adb.getBatteryInfo(raw.serial),
      ]);

      const manufacturer =
        mfgResult.status === 'fulfilled' && mfgResult.value
          ? mfgResult.value.trim()
          : 'generic';
      const model =
        mdlResult.status === 'fulfilled' && mdlResult.value
          ? mdlResult.value.trim()
          : raw.model || raw.serial;
      const androidVersion =
        verResult.status === 'fulfilled' && verResult.value
          ? verResult.value.trim()
          : '14';
      const battery =
        battResult.status === 'fulfilled' && battResult.value
          ? battResult.value
          : defaultBattery;

      const brand = detectBrand(manufacturer);

      entry = {
        staticProps: {
          serial: raw.serial,
          brand,
          manufacturer,
          model,
          androidVersion,
          connectionType: isWifi ? 'wifi' : 'usb',
          ipAddress: addressInfo.ip,
          port: addressInfo.port,
          loaded: true,
        },
        battery,
        lastBatteryFetch: now,
      };

      this.cache.set(raw.serial, entry);
    } else {
      // 2. Device is cached. Check if battery should be refreshed (throttled)
      const shouldRefreshBattery =
        forceBattery || now - entry.lastBatteryFetch >= this.batteryRefreshIntervalMs;

      if (shouldRefreshBattery) {
        try {
          entry.battery = await this.adb.getBatteryInfo(raw.serial);
          entry.lastBatteryFetch = now;
        } catch {
          // Keep existing cached battery on intermittent failure
        }
      }
    }

    return {
      serial: raw.serial,
      state: 'device',
      brand: entry.staticProps.brand,
      manufacturer: entry.staticProps.manufacturer,
      model: entry.staticProps.model,
      androidVersion: entry.staticProps.androidVersion,
      connectionType: entry.staticProps.connectionType,
      ipAddress: entry.staticProps.ipAddress,
      port: entry.staticProps.port,
      battery: { ...entry.battery },
    };
  }

  /**
   * Schedules the next tick using adaptive backoff.
   */
  private scheduleNextTick(): void {
    if (!this.isRunning) return;

    if (this.timerId !== null) {
      clearTimeout(this.timerId);
      this.timerId = null;
    }

    let delay = this.pollIntervalMs;
    if (this.consecutiveErrors > 0) {
      delay = Math.min(
        this.pollIntervalMs * Math.pow(1.5, this.consecutiveErrors),
        this.maxBackoffMs
      );
    }

    this.timerId = setTimeout(() => {
      this.timerId = null;
      void this.pollTick(false);
    }, delay);
  }
}
