import { EventEmitter } from 'node:events';
import type { IAdbExecutor, DeviceRawRecord } from '../adapters/IAdbExecutor';
import type { DeviceManager } from './DeviceManager';
import {
  RecentDevicesStore,
  type RecentDevice,
  type AddRecentDeviceInput,
} from './RecentDevicesStore';
import type {
  PairWirelessPayload,
  OperationResult,
  MigrateWirelessResult,
  DeviceBrand,
} from '../../../src/types';

export type MigrationStep =
  | 'IDLE'
  | 'VALIDATING'
  | 'RESOLVING_IP'
  | 'SWITCHING_TCPIP'
  | 'WAITING_DAEMON'
  | 'CONNECTING'
  | 'VERIFYING'
  | 'COMPLETED'
  | 'FAILED';

export type MigrationErrorCode =
  | 'E_INVALID_ARGS'
  | 'E_ALREADY_WIFI'
  | 'E_DEVICE_NOT_FOUND'
  | 'E_DEVICE_NOT_READY'
  | 'E_DEVICE_UNAUTHORIZED'
  | 'E_DEVICE_OFFLINE'
  | 'E_NO_WIFI_IP'
  | 'E_INVALID_IP'
  | 'E_TCPIP_FAILED'
  | 'E_CONNECT_FAILED'
  | 'E_WIFI_UNAUTHORIZED'
  | 'E_WIFI_OFFLINE'
  | 'E_VERIFICATION_FAILED'
  | 'E_TIMEOUT'
  | 'E_UNKNOWN';

export interface MigrationProgress {
  serial: string;
  step: MigrationStep;
  progressPercent: number;
  message: string;
}

export interface MigrationOptions {
  port?: number;
  daemonDelayMs?: number;
  connectRetries?: number;
  connectRetryDelayMs?: number;
  verificationRetries?: number;
  verificationRetryDelayMs?: number;
  timeoutMs?: number;
  onProgress?: (progress: MigrationProgress) => void;
}

export interface MigrationResult extends MigrateWirelessResult {
  success: boolean;
  ip?: string;
  port?: number;
  wifiSerial?: string;
  error?: string;
  errorCode?: MigrationErrorCode;
  step?: MigrationStep;
}

export interface PairingResult extends OperationResult {
  success: boolean;
  paired?: boolean;
  connected?: boolean;
  ip?: string;
  connectPort?: number;
  device?: RecentDevice;
  error?: string;
}

export interface WirelessWizardOptions {
  deviceManager?: DeviceManager;
  recentStore?: RecentDevicesStore;
  delayMs?: number;
  daemonDelayMs?: number;
  maxRecentDevices?: number;
  connectRetries?: number;
  connectRetryDelayMs?: number;
  verificationRetries?: number;
  verificationRetryDelayMs?: number;
  timeoutMs?: number;
}

// =========================================================================
// Pure Validation & Helper Functions
// =========================================================================

/**
 * Validates a 6-digit numeric pairing PIN code.
 * Strict requirements: exactly 6 digits 0-9, rejects 000000 (test reject code), non-numeric, whitespace.
 */
export function validatePairingPin(code: string): { valid: boolean; error?: string } {
  if (typeof code !== 'string') {
    return { valid: false, error: 'Pairing code must be a string of 6 digits.' };
  }
  const trimmed = code.trim();
  if (trimmed.length !== 6 || code !== trimmed) {
    return { valid: false, error: 'Pairing code must be exactly 6 numeric digits without whitespace.' };
  }
  if (!/^\d{6}$/.test(trimmed)) {
    return { valid: false, error: 'Pairing code must contain only numeric digits (0-9).' };
  }
  if (trimmed === '000000') {
    return { valid: false, error: 'Pairing code "000000" is disallowed or expired.' };
  }
  return { valid: true };
}

export function validatePairingCode(code: string): boolean {
  return validatePairingPin(code).valid;
}

/**
 * Validates TCP port number (1-65535).
 */
export function validatePort(port: number): { valid: boolean; error?: string } {
  if (typeof port !== 'number' || !Number.isInteger(port) || Number.isNaN(port)) {
    return { valid: false, error: `Invalid port ${port}. Port must be an integer.` };
  }
  if (port < 1 || port > 65535) {
    return { valid: false, error: `Port ${port} is out of bounds. Must be between 1 and 65535.` };
  }
  return { valid: true };
}

/**
 * Validates IPv4 address string format (4 octets, 0-255).
 */
export function validateIpAddress(ip: string): { valid: boolean; error?: string } {
  if (!ip || typeof ip !== 'string') {
    return { valid: false, error: 'IP address is required.' };
  }
  const trimmed = ip.trim();
  const parts = trimmed.split('.');
  if (parts.length !== 4) {
    return { valid: false, error: `Invalid IP address format: "${ip}". Expected 4 octets.` };
  }
  for (const part of parts) {
    if (!/^\d+$/.test(part)) {
      return { valid: false, error: `Invalid IP octet: "${part}". Must contain only numbers.` };
    }
    const n = Number(part);
    if (n < 0 || n > 255) {
      return { valid: false, error: `Octet out of range: ${n}. Must be between 0 and 255.` };
    }
  }
  return { valid: true };
}

export function isValidIpv4(ip: string): boolean {
  return validateIpAddress(ip).valid;
}

/**
 * Formats IP and port into standard ADB endpoint string (ip:port).
 */
export function formatDeviceAddress(ip: string, port = 5555): string {
  const cleanIp = (ip || '').trim();
  return `${cleanIp}:${port}`;
}

/**
 * Parses ADB endpoint address into ip and port components.
 */
export function parseDeviceAddress(address: string): { ip: string; port: number } {
  const clean = (address || '').trim();
  if (clean.includes(':')) {
    const [ipPart, portPart] = clean.split(':');
    const portNum = parseInt(portPart, 10);
    return {
      ip: ipPart,
      port: Number.isNaN(portNum) ? 5555 : portNum,
    };
  }
  return {
    ip: clean,
    port: 5555,
  };
}

/**
 * Evaluates ADB connect output defending against the code-0 failure quirk.
 * adb connect returns exit code 0 even when connection fails.
 */
export function parseConnectOutput(output: string): { success: boolean; reason?: string } {
  const text = (output || '').trim();
  const lower = text.toLowerCase();

  const isFailure =
    lower.includes('failed to connect') ||
    lower.includes('cannot connect') ||
    lower.includes('connection refused') ||
    lower.includes('timed out') ||
    lower.includes('no route to host') ||
    lower.includes('error:');

  if (isFailure) {
    return { success: false, reason: text };
  }

  const isSuccess =
    lower.includes('connected to') ||
    lower.includes('already connected');

  if (isSuccess) {
    return { success: true };
  }

  return { success: false, reason: text || 'Unknown response from ADB connect' };
}

// =========================================================================
// WirelessWizard Service Implementation
// =========================================================================

export class WirelessWizard extends EventEmitter {
  private readonly adb: IAdbExecutor;
  private readonly recentStore: RecentDevicesStore;
  private readonly deviceManager?: DeviceManager;
  private readonly delayMs: number;
  private activeTimers: Set<NodeJS.Timeout> = new Set();
  private disposed: boolean = false;

  constructor(
    adb: IAdbExecutor,
    optionsOrDeviceManager?: WirelessWizardOptions | DeviceManager
  ) {
    super();
    this.adb = adb;

    if (
      optionsOrDeviceManager &&
      typeof (optionsOrDeviceManager as any).refresh === 'function' &&
      typeof (optionsOrDeviceManager as any).getDevices === 'function'
    ) {
      this.deviceManager = optionsOrDeviceManager as DeviceManager;
      this.recentStore = new RecentDevicesStore();
      this.delayMs = 500;
    } else {
      const options = (optionsOrDeviceManager as WirelessWizardOptions) || {};
      this.deviceManager = options.deviceManager;
      this.recentStore =
        options.recentStore ??
        new RecentDevicesStore({ maxRecentDevices: options.maxRecentDevices });
      this.delayMs = options.delayMs ?? options.daemonDelayMs ?? 500;
    }
  }

  /**
   * Safe timer delay with disposal protection
   */
  private delay(ms: number): Promise<void> {
    if (ms <= 0 || this.disposed) return Promise.resolve();
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.activeTimers.delete(timer);
        resolve();
      }, ms);
      this.activeTimers.add(timer);
    });
  }

  public dispose(): void {
    this.disposed = true;
    for (const timer of this.activeTimers) {
      clearTimeout(timer);
    }
    this.activeTimers.clear();
    this.removeAllListeners();
  }

  // =========================================================================
  // 1-Click USB-to-Wi-Fi Migration
  // =========================================================================

  public async migrateToWifi(
    serial: string,
    options: MigrationOptions = {}
  ): Promise<MigrationResult> {
    const {
      port = 5555,
      daemonDelayMs = this.delayMs,
      connectRetries = 3,
      connectRetryDelayMs = this.delayMs > 0 ? 500 : 0,
      verificationRetries = 3,
      verificationRetryDelayMs = this.delayMs > 0 ? 500 : 0,
      timeoutMs = 15000,
      onProgress,
    } = options;

    const reportProgress = (step: MigrationStep, percent: number, message: string) => {
      const data: MigrationProgress = { serial, step, progressPercent: percent, message };
      this.emit('migration-progress', data);
      onProgress?.(data);
    };

    const runMigration = async (): Promise<MigrationResult> => {
      // 1. STEP 1: VALIDATING
      reportProgress('VALIDATING', 10, 'Validating device connection...');
      if (!serial || typeof serial !== 'string' || serial.trim().length === 0) {
        return {
          success: false,
          errorCode: 'E_INVALID_ARGS',
          step: 'VALIDATING',
          error: 'Serial number is required.',
        };
      }

      const cleanSerial = serial.trim();
      if (cleanSerial.includes(':')) {
        return {
          success: false,
          errorCode: 'E_ALREADY_WIFI',
          step: 'VALIDATING',
          error: `Device '${cleanSerial}' is already connected via Wi-Fi.`,
        };
      }

      const devices = await this.adb.getDevices();
      const currentDev = devices.find((d) => d.serial === cleanSerial);
      if (!currentDev) {
        return {
          success: false,
          errorCode: 'E_DEVICE_NOT_FOUND',
          step: 'VALIDATING',
          error: `Device '${cleanSerial}' not found. Please connect via USB.`,
        };
      }

      if (currentDev.state === 'unauthorized') {
        return {
          success: false,
          errorCode: 'E_DEVICE_UNAUTHORIZED',
          step: 'VALIDATING',
          error: `Device '${cleanSerial}' is unauthorized. Please accept the USB debugging prompt on your phone.`,
        };
      }

      if (currentDev.state === 'offline') {
        return {
          success: false,
          errorCode: 'E_DEVICE_OFFLINE',
          step: 'VALIDATING',
          error: `Device '${cleanSerial}' is offline. Please reconnect USB cable.`,
        };
      }

      if (currentDev.state !== 'device') {
        return {
          success: false,
          errorCode: 'E_DEVICE_NOT_READY',
          step: 'VALIDATING',
          error: `Device '${cleanSerial}' is not ready (state: ${currentDev.state}).`,
        };
      }

      // 2. STEP 2: RESOLVING_IP
      reportProgress('RESOLVING_IP', 25, 'Retrieving device Wi-Fi IP address...');
      const ip = await this.adb.getDeviceIp(cleanSerial);
      if (!ip) {
        return {
          success: false,
          errorCode: 'E_NO_WIFI_IP',
          step: 'RESOLVING_IP',
          error: `No Wi-Fi IP address found for device '${cleanSerial}'. Ensure phone is connected to Wi-Fi.`,
        };
      }

      const ipValidation = validateIpAddress(ip);
      if (!ipValidation.valid) {
        return {
          success: false,
          errorCode: 'E_INVALID_IP',
          step: 'RESOLVING_IP',
          error: `Invalid Wi-Fi IP address detected (${ip}).`,
        };
      }

      // 3. STEP 3: SWITCHING_TCPIP
      reportProgress('SWITCHING_TCPIP', 45, `Switching ADB daemon to TCP/IP port ${port}...`);
      const tcpipRes = await this.adb.switchTcpip(cleanSerial, port);
      if (!tcpipRes.success) {
        return {
          success: false,
          ip,
          port,
          errorCode: 'E_TCPIP_FAILED',
          step: 'SWITCHING_TCPIP',
          error: `Failed to switch device to TCP/IP mode: ${tcpipRes.error || tcpipRes.output}`,
        };
      }

      // 4. STEP 4: WAITING_DAEMON
      reportProgress('WAITING_DAEMON', 60, 'Waiting for ADB daemon to restart in TCP mode...');
      if (daemonDelayMs > 0) {
        await this.delay(daemonDelayMs);
      }

      // 5. STEP 5: CONNECTING
      const targetAddress = formatDeviceAddress(ip, port);
      reportProgress('CONNECTING', 75, `Connecting wirelessly to ${targetAddress}...`);

      let lastConnectError = '';
      let connectSuccessful = false;

      for (let attempt = 1; attempt <= connectRetries; attempt++) {
        const connectRes = await this.adb.connect(targetAddress);
        const parsed = parseConnectOutput(connectRes.output);

        if (connectRes.success && parsed.success) {
          connectSuccessful = true;
          break;
        }

        lastConnectError = parsed.reason || connectRes.error || connectRes.output;
        if (attempt < connectRetries && connectRetryDelayMs > 0) {
          await this.delay(connectRetryDelayMs * attempt);
        }
      }

      if (!connectSuccessful) {
        return {
          success: false,
          ip,
          port,
          errorCode: 'E_CONNECT_FAILED',
          step: 'CONNECTING',
          error: `Failed to connect wirelessly to ${targetAddress}: ${lastConnectError}`,
        };
      }

      // 6. STEP 6: VERIFYING
      reportProgress('VERIFYING', 90, 'Verifying wireless connection in device list...');
      let verifiedRecord: DeviceRawRecord | undefined;

      for (let vAttempt = 1; vAttempt <= verificationRetries; vAttempt++) {
        const latestDevices = await this.adb.getDevices();
        verifiedRecord = latestDevices.find((d) => d.serial === targetAddress);
        if (verifiedRecord) break;
        if (vAttempt < verificationRetries && verificationRetryDelayMs > 0) {
          await this.delay(verificationRetryDelayMs);
        }
      }

      if (!verifiedRecord) {
        return {
          success: false,
          ip,
          port,
          errorCode: 'E_VERIFICATION_FAILED',
          step: 'VERIFYING',
          error: `Wireless connection to ${targetAddress} completed, but device was not detected in active list.`,
        };
      }

      if (verifiedRecord.state === 'unauthorized') {
        return {
          success: false,
          ip,
          port,
          wifiSerial: targetAddress,
          errorCode: 'E_WIFI_UNAUTHORIZED',
          step: 'VERIFYING',
          error: `Device ${targetAddress} connected wirelessly but requires RSA authorization. Please accept the prompt on your phone screen.`,
        };
      }

      if (verifiedRecord.state === 'offline') {
        return {
          success: false,
          ip,
          port,
          wifiSerial: targetAddress,
          errorCode: 'E_WIFI_OFFLINE',
          step: 'VERIFYING',
          error: `Device ${targetAddress} connected wirelessly but is offline.`,
        };
      }

      // 7. STEP 7: COMPLETED
      reportProgress(
        'COMPLETED',
        100,
        `Successfully connected wirelessly to ${targetAddress}! You may now disconnect the USB cable.`
      );

      // Record in Recent Devices Store
      let brand: DeviceBrand = 'generic';
      let modelName = targetAddress;
      try {
        const [mfg, mdl] = await Promise.all([
          this.adb.getProp(cleanSerial, 'ro.product.manufacturer').catch(() => ''),
          this.adb.getProp(cleanSerial, 'ro.product.model').catch(() => ''),
        ]);
        if (mfg.toLowerCase().includes('samsung')) brand = 'samsung';
        else if (mfg.toLowerCase().includes('motorola')) brand = 'motorola';
        if (mdl) modelName = mdl;
      } catch {
        // Fallback
      }

      this.recentStore.addRecentDevice({
        ip,
        port,
        name: modelName,
        brand,
      });
      this.emit('recent-devices-changed', this.recentStore.getRecentDevices());

      if (this.deviceManager) {
        await this.deviceManager.refresh().catch(() => {});
      }

      return {
        success: true,
        ip,
        port,
        wifiSerial: targetAddress,
        step: 'COMPLETED',
      };
    };

    // Operation timeout guard
    let timerId: NodeJS.Timeout | undefined;
    const timeoutPromise = new Promise<MigrationResult>((resolve) => {
      timerId = setTimeout(() => {
        if (timerId) this.activeTimers.delete(timerId);
        resolve({
          success: false,
          errorCode: 'E_TIMEOUT',
          step: 'FAILED',
          error: `USB-to-Wi-Fi migration timed out after ${Math.round(timeoutMs / 1000)} seconds.`,
        });
      }, timeoutMs);
      this.activeTimers.add(timerId);
    });

    try {
      const result = await Promise.race([runMigration(), timeoutPromise]);
      return result;
    } finally {
      if (timerId) {
        clearTimeout(timerId);
        this.activeTimers.delete(timerId);
      }
    }
  }

  // =========================================================================
  // Android 11+ Pairing Flow
  // =========================================================================

  public async pairDevice(
    payloadOrIp: PairWirelessPayload | string,
    pairingPortArg?: number,
    codeArg?: string,
    connectPortArg?: number
  ): Promise<PairingResult> {
    let ip: string;
    let pairingPort: number;
    let code: string;
    let connectPort: number;

    if (typeof payloadOrIp === 'object' && payloadOrIp !== null) {
      ip = (payloadOrIp.ip || '').trim();
      pairingPort = payloadOrIp.pairingPort;
      code = (payloadOrIp.code || '').trim();
      connectPort = payloadOrIp.connectPort ?? 5555;
    } else {
      ip = (payloadOrIp || '').trim();
      pairingPort = pairingPortArg!;
      code = (codeArg || '').trim();
      connectPort = connectPortArg ?? 5555;
    }

    // 1. Client-Side Input Validations (Immediate rejection before any CLI execution)
    const ipVal = validateIpAddress(ip);
    if (!ipVal.valid) {
      return {
        success: false,
        paired: false,
        connected: false,
        ip,
        connectPort,
        error: ipVal.error || `Invalid IP address: "${ip}".`,
      };
    }

    const pairPortVal = validatePort(pairingPort);
    if (!pairPortVal.valid) {
      return {
        success: false,
        paired: false,
        connected: false,
        ip,
        connectPort,
        error: pairPortVal.error || `Invalid pairing port: ${pairingPort}.`,
      };
    }

    const connPortVal = validatePort(connectPort);
    if (!connPortVal.valid) {
      return {
        success: false,
        paired: false,
        connected: false,
        ip,
        connectPort,
        error: connPortVal.error || `Invalid connection port: ${connectPort}.`,
      };
    }

    const pinVal = validatePairingPin(code);
    if (!pinVal.valid) {
      return {
        success: false,
        paired: false,
        connected: false,
        ip,
        connectPort,
        error: pinVal.error || 'Pairing code must be exactly 6 numeric digits.',
      };
    }

    this.emit('pairing-state-changed', { state: 'pairing', ip, pairingPort });

    // 2. Execute Pairing via ADB
    const pairTarget = formatDeviceAddress(ip, pairingPort);
    const pairRes = await this.adb.pair(pairTarget, code);

    const pairLower = (pairRes.output || '').toLowerCase();
    const isPairSuccess = pairRes.success && pairLower.includes('successfully paired');

    if (!isPairSuccess) {
      const friendlyError = pairRes.output || 'Pairing failed';

      this.emit('pairing-state-changed', { state: 'error', error: friendlyError });
      return {
        success: false,
        paired: false,
        connected: false,
        ip,
        connectPort,
        error: friendlyError,
      };
    }

    this.emit('pairing-state-changed', { state: 'connecting', ip, connectPort });

    // 3. Execute Connection to Connection Port
    const connectTarget = formatDeviceAddress(ip, connectPort);
    const connRes = await this.adb.connect(connectTarget);
    const parsedConnect = parseConnectOutput(connRes.output);

    if (!connRes.success || !parsedConnect.success) {
      const connectError =
        connRes.output ||
        parsedConnect.reason ||
        `Device paired successfully, but failed to connect to ${connectTarget}: Connection refused`;
      this.emit('pairing-state-changed', { state: 'partial_success', error: connectError });
      return {
        success: false,
        paired: true,
        connected: false,
        ip,
        connectPort,
        error: connectError,
      };
    }

    // 4. Resolve Device Properties & Persist into Recent Devices Store
    let brand: DeviceBrand = 'generic';
    let modelName = connectTarget;

    try {
      const [mfg, mdl] = await Promise.all([
        this.adb.getProp(connectTarget, 'ro.product.manufacturer').catch(() => ''),
        this.adb.getProp(connectTarget, 'ro.product.model').catch(() => ''),
      ]);
      if (mfg.toLowerCase().includes('samsung')) brand = 'samsung';
      else if (mfg.toLowerCase().includes('motorola')) brand = 'motorola';
      if (mdl) modelName = mdl;
    } catch {
      // Fallback
    }

    const savedDevice = this.recentStore.addRecentDevice({
      ip,
      port: connectPort,
      name: modelName,
      brand,
    });

    if (this.deviceManager) {
      void this.deviceManager.refresh().catch(() => {});
    }

    this.emit('pairing-state-changed', { state: 'success', device: savedDevice });
    this.emit('recent-devices-changed', this.recentStore.getRecentDevices());

    return {
      success: true,
      paired: true,
      connected: true,
      ip,
      connectPort,
      device: savedDevice,
    };
  }

  // =========================================================================
  // Direct Wireless Connect & Disconnect
  // =========================================================================

  public async connectWireless(
    addressOrIp: string,
    portArg?: number
  ): Promise<OperationResult> {
    if (!addressOrIp || typeof addressOrIp !== 'string') {
      return { success: false, error: 'Target address or IP is required' };
    }

    const clean = addressOrIp.trim();
    let targetAddress: string;
    let ip: string;
    let port: number;

    if (portArg !== undefined) {
      ip = clean;
      port = portArg;
      targetAddress = formatDeviceAddress(ip, port);
    } else if (clean.includes(':')) {
      targetAddress = clean;
      const parsed = parseDeviceAddress(clean);
      ip = parsed.ip;
      port = parsed.port;
    } else {
      ip = clean;
      port = 5555;
      targetAddress = formatDeviceAddress(clean, 5555);
    }

    const connRes = await this.adb.connect(targetAddress);
    const parsed = parseConnectOutput(connRes.output);

    if (!connRes.success || !parsed.success) {
      return {
        success: false,
        error: connRes.output || parsed.reason || `Failed to connect to ${targetAddress}`,
      };
    }

    let brand: DeviceBrand = 'generic';
    let modelName = targetAddress;
    try {
      const [mfg, mdl] = await Promise.all([
        this.adb.getProp(targetAddress, 'ro.product.manufacturer').catch(() => ''),
        this.adb.getProp(targetAddress, 'ro.product.model').catch(() => ''),
      ]);
      if (mfg.toLowerCase().includes('samsung')) brand = 'samsung';
      else if (mfg.toLowerCase().includes('motorola')) brand = 'motorola';
      if (mdl) modelName = mdl;
    } catch {
      // Fallback
    }

    this.recentStore.addRecentDevice({
      ip,
      port,
      name: modelName,
      brand,
    });

    if (this.deviceManager) {
      void this.deviceManager.refresh().catch(() => {});
    }

    this.emit('recent-devices-changed', this.recentStore.getRecentDevices());

    return { success: true };
  }

  public async disconnectWireless(address?: string): Promise<OperationResult> {
    const res = await this.adb.disconnect(address);
    if (this.deviceManager) {
      void this.deviceManager.refresh().catch(() => {});
    }
    return {
      success: res.success,
      error: res.success ? undefined : res.output,
    };
  }

  // =========================================================================
  // Recent Devices Store Accessors & Helpers
  // =========================================================================

  public getRecentDevices(): RecentDevice[] {
    return this.recentStore.getRecentDevices();
  }

  public addRecentDevice(entry: AddRecentDeviceInput): RecentDevice {
    const device = this.recentStore.addRecentDevice(entry);
    this.emit('recent-devices-changed', this.recentStore.getRecentDevices());
    return device;
  }

  public removeRecentDevice(idOrAddress: string): boolean {
    const removed = this.recentStore.removeRecentDevice(idOrAddress);
    if (removed) {
      this.emit('recent-devices-changed', this.recentStore.getRecentDevices());
    }
    return removed;
  }

  public clearRecentDevices(): void {
    this.recentStore.clearRecentDevices();
    this.emit('recent-devices-changed', this.recentStore.getRecentDevices());
  }

  public getRecentStore(): RecentDevicesStore {
    return this.recentStore;
  }
}
