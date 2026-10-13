import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  DeviceManager,
  detectBrand,
  detectConnectionType,
  parseSerialAddress,
  isBatteryEqual,
  isDeviceEqual,
  areDeviceListsEqual,
} from '../../electron/main/services/DeviceManager';
import { MockAdbExecutor } from '../../electron/main/adapters/MockAdbExecutor';
import {
  MOCK_SAMSUNG_S24,
  MOCK_MOTOROLA_EDGE,
  MOCK_GENERIC_ANDROID,
} from '../fixtures/mockDevices';
import type { DeviceInfo, BatteryInfo } from '../../src/types';

describe('DeviceManager Unit Tests', () => {
  let mockAdb: MockAdbExecutor;
  let manager: DeviceManager;

  beforeEach(() => {
    vi.useFakeTimers();
    mockAdb = new MockAdbExecutor([]);
  });

  afterEach(() => {
    if (manager) {
      manager.dispose();
    }
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  describe('Pure Helper Functions', () => {
    it('detectBrand correctly classifies manufacturers', () => {
      expect(detectBrand('Samsung')).toBe('samsung');
      expect(detectBrand('samsung electronics co., ltd.')).toBe('samsung');
      expect(detectBrand('SAMSUNG')).toBe('samsung');

      expect(detectBrand('Motorola')).toBe('motorola');
      expect(detectBrand('motorola mobility llc')).toBe('motorola');
      expect(detectBrand('Lenovo')).toBe('motorola');
      expect(detectBrand('LENOVO')).toBe('motorola');

      expect(detectBrand('Google')).toBe('generic');
      expect(detectBrand('Xiaomi')).toBe('generic');
      expect(detectBrand('OnePlus')).toBe('generic');
      expect(detectBrand('')).toBe('generic');
      expect(detectBrand(null as any)).toBe('generic');
    });

    it('detectConnectionType differentiates USB vs Wi-Fi', () => {
      expect(detectConnectionType('R5CW10ABCDE')).toBe('usb');
      expect(detectConnectionType('ZY22ABCD12')).toBe('usb');
      expect(detectConnectionType('emulator-5554')).toBe('usb');
      expect(detectConnectionType('192.168.1.100:5555')).toBe('wifi');
      expect(detectConnectionType('10.0.0.5:4321')).toBe('wifi');
    });

    it('parseSerialAddress extracts host and port', () => {
      expect(parseSerialAddress('192.168.1.100:5555')).toEqual({
        ip: '192.168.1.100',
        port: 5555,
      });
      expect(parseSerialAddress('10.0.0.5:4321')).toEqual({
        ip: '10.0.0.5',
        port: 4321,
      });
      expect(parseSerialAddress('R5CW10ABCDE')).toEqual({});
      expect(parseSerialAddress('invalid:string:extra')).toEqual({});
      expect(parseSerialAddress('')).toEqual({});
    });

    it('isBatteryEqual performs deep comparison', () => {
      const b1: BatteryInfo = { level: 85, scale: 100, status: 2, isCharging: true, powerSource: 'usb' };
      const b2: BatteryInfo = { level: 85, scale: 100, status: 2, isCharging: true, powerSource: 'usb' };
      const b3: BatteryInfo = { level: 84, scale: 100, status: 2, isCharging: true, powerSource: 'usb' };

      expect(isBatteryEqual(b1, b2)).toBe(true);
      expect(isBatteryEqual(b1, b3)).toBe(false);
    });

    it('isDeviceEqual performs full property comparison', () => {
      const d1: DeviceInfo = {
        serial: 'DEV1',
        state: 'device',
        brand: 'samsung',
        manufacturer: 'samsung',
        model: 'SM-S928B',
        androidVersion: '14',
        connectionType: 'usb',
        battery: { level: 90, scale: 100, status: 2, isCharging: true, powerSource: 'usb' },
      };
      const d2: DeviceInfo = { ...d1, battery: { ...d1.battery } };
      const d3: DeviceInfo = { ...d1, state: 'offline' };

      expect(isDeviceEqual(d1, d2)).toBe(true);
      expect(isDeviceEqual(d1, d3)).toBe(false);
    });

    it('areDeviceListsEqual compares arrays order-independently by serial', () => {
      const d1: DeviceInfo = {
        serial: 'DEV1',
        state: 'device',
        brand: 'samsung',
        manufacturer: 'samsung',
        model: 'SM-S928B',
        androidVersion: '14',
        connectionType: 'usb',
        battery: { level: 90, scale: 100, status: 2, isCharging: true, powerSource: 'usb' },
      };
      const d2: DeviceInfo = {
        serial: 'DEV2',
        state: 'device',
        brand: 'motorola',
        manufacturer: 'motorola',
        model: 'Edge',
        androidVersion: '14',
        connectionType: 'usb',
        battery: { level: 70, scale: 100, status: 3, isCharging: false, powerSource: 'battery' },
      };

      expect(areDeviceListsEqual([d1, d2], [d2, d1])).toBe(true);
      expect(areDeviceListsEqual([d1], [d1, d2])).toBe(false);
      expect(areDeviceListsEqual([d1], [])).toBe(false);
      expect(areDeviceListsEqual([], [])).toBe(true);
    });
  });

  describe('Discovery, Attachment & Detachment SLAs', () => {
    it('detects newly attached device within 3 seconds (2s poll cadence)', async () => {
      mockAdb.reset([]);
      manager = new DeviceManager(mockAdb, { pollIntervalMs: 2000, autoStart: true });

      const emittedUpdates: DeviceInfo[][] = [];
      const emittedAttached: DeviceInfo[] = [];

      manager.on('devices-updated', (devs) => emittedUpdates.push(devs));
      manager.on('device-attached', (dev) => emittedAttached.push(dev));

      // Initial tick with 0 devices
      await vi.advanceTimersByTimeAsync(10);
      expect(manager.getDevices()).toHaveLength(0);
      expect(emittedUpdates).toHaveLength(0);

      // Connect Samsung S24
      mockAdb.simulateDeviceConnect(MOCK_SAMSUNG_S24);

      // Advance by 2000ms (next tick)
      await vi.advanceTimersByTimeAsync(2000);

      expect(emittedUpdates).toHaveLength(1);
      expect(emittedUpdates[0]).toHaveLength(1);
      expect(emittedUpdates[0][0].serial).toBe(MOCK_SAMSUNG_S24.raw.serial);
      expect(emittedUpdates[0][0].brand).toBe('samsung');
      expect(emittedUpdates[0][0].model).toBe('SM-S928B');
      expect(emittedUpdates[0][0].connectionType).toBe('usb');

      expect(emittedAttached).toHaveLength(1);
      expect(emittedAttached[0].serial).toBe(MOCK_SAMSUNG_S24.raw.serial);
    });

    it('detects detached device within 3 seconds and evicts cache', async () => {
      mockAdb.reset([MOCK_SAMSUNG_S24]);
      manager = new DeviceManager(mockAdb, { pollIntervalMs: 2000, autoStart: true });

      const emittedUpdates: DeviceInfo[][] = [];
      const emittedDetached: DeviceInfo[] = [];

      manager.on('devices-updated', (devs) => emittedUpdates.push(devs));
      manager.on('device-detached', (dev) => emittedDetached.push(dev));

      // Initial poll captures the device
      await vi.advanceTimersByTimeAsync(10);
      expect(manager.getDevices()).toHaveLength(1);
      expect(manager.getCacheSize()).toBe(1);
      expect(emittedUpdates).toHaveLength(1);

      // Disconnect device
      mockAdb.simulateDeviceDisconnect(MOCK_SAMSUNG_S24.raw.serial);

      // Advance by 2000ms (< 3000ms requirement)
      await vi.advanceTimersByTimeAsync(2000);

      expect(emittedUpdates).toHaveLength(2);
      expect(emittedUpdates[1]).toEqual([]);
      expect(emittedDetached).toHaveLength(1);
      expect(emittedDetached[0].serial).toBe(MOCK_SAMSUNG_S24.raw.serial);

      // Cache must be evicted
      expect(manager.getCacheSize()).toBe(0);
      expect(manager.getDevices()).toHaveLength(0);
    });

    it('correctly reports Wi-Fi connection with parsed IP address and port', async () => {
      mockAdb.reset([MOCK_GENERIC_ANDROID]);
      manager = new DeviceManager(mockAdb, { pollIntervalMs: 2000, autoStart: true });

      await vi.advanceTimersByTimeAsync(10);

      const devices = manager.getDevices();
      expect(devices).toHaveLength(1);
      expect(devices[0].connectionType).toBe('wifi');
      expect(devices[0].ipAddress).toBe('192.168.1.103');
      expect(devices[0].port).toBe(5555);
      expect(devices[0].brand).toBe('generic');
    });
  });

  describe('Diffing Algorithm & Event Suppression', () => {
    it('suppresses devices-updated events across identical consecutive ticks', async () => {
      mockAdb.reset([MOCK_SAMSUNG_S24, MOCK_MOTOROLA_EDGE]);
      manager = new DeviceManager(mockAdb, { pollIntervalMs: 2000, autoStart: true });

      let eventCallCount = 0;
      manager.on('devices-updated', () => {
        eventCallCount++;
      });

      // Initial tick discovers 2 devices
      await vi.advanceTimersByTimeAsync(10);
      expect(eventCallCount).toBe(1);

      // Run 5 consecutive poll ticks with no state changes (10 seconds total)
      for (let i = 0; i < 5; i++) {
        await vi.advanceTimersByTimeAsync(2000);
      }

      // Event count MUST stay strictly 1 (all 5 ticks suppressed)
      expect(eventCallCount).toBe(1);
    });
  });

  describe('Property Cache & Battery Throttling', () => {
    it('queries static properties only once per connection lifetime', async () => {
      mockAdb.reset([MOCK_SAMSUNG_S24]);
      manager = new DeviceManager(mockAdb, { pollIntervalMs: 2000, autoStart: true });

      const getPropSpy = vi.spyOn(mockAdb, 'getProp');

      // Initial tick fetches 3 properties
      await vi.advanceTimersByTimeAsync(10);
      expect(getPropSpy).toHaveBeenCalledTimes(3);

      // Advance through 3 subsequent poll ticks (6 seconds)
      await vi.advanceTimersByTimeAsync(2000);
      await vi.advanceTimersByTimeAsync(2000);
      await vi.advanceTimersByTimeAsync(2000);

      // Zero additional getProp calls during steady-state ticks
      expect(getPropSpy).toHaveBeenCalledTimes(3);
      expect(manager.getCacheSize()).toBe(1);
    });

    it('throttles battery queries to every 10 seconds', async () => {
      mockAdb.reset([MOCK_SAMSUNG_S24]);
      manager = new DeviceManager(mockAdb, {
        pollIntervalMs: 2000,
        batteryRefreshIntervalMs: 10000,
        autoStart: true,
      });

      const getBatterySpy = vi.spyOn(mockAdb, 'getBatteryInfo');

      // t = 0s: initial discovery
      await vi.advanceTimersByTimeAsync(10);
      expect(getBatterySpy).toHaveBeenCalledTimes(1);

      // t = 2s, 4s, 6s, 8s: battery throttled
      await vi.advanceTimersByTimeAsync(2000);
      expect(getBatterySpy).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(2000);
      expect(getBatterySpy).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(2000);
      expect(getBatterySpy).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(2000);
      expect(getBatterySpy).toHaveBeenCalledTimes(1);

      // t = 10s: interval elapsed, battery is queried again
      await vi.advanceTimersByTimeAsync(2000);
      expect(getBatterySpy).toHaveBeenCalledTimes(2);
    });

    it('manual refresh forces immediate battery query bypassing throttle', async () => {
      mockAdb.reset([MOCK_SAMSUNG_S24]);
      manager = new DeviceManager(mockAdb, {
        pollIntervalMs: 2000,
        batteryRefreshIntervalMs: 10000,
        autoStart: true,
      });

      const getBatterySpy = vi.spyOn(mockAdb, 'getBatteryInfo');

      await vi.advanceTimersByTimeAsync(10);
      expect(getBatterySpy).toHaveBeenCalledTimes(1);

      // Advance only 2s (well inside the 10s throttle window)
      await vi.advanceTimersByTimeAsync(2000);
      expect(getBatterySpy).toHaveBeenCalledTimes(1);

      // Trigger manual refresh with forceBattery = true
      await manager.refresh(true);
      expect(getBatterySpy).toHaveBeenCalledTimes(2);
    });

    it('emits devices-updated when battery level changes after throttle interval', async () => {
      mockAdb.reset([MOCK_SAMSUNG_S24]);
      manager = new DeviceManager(mockAdb, {
        pollIntervalMs: 2000,
        batteryRefreshIntervalMs: 10000,
        autoStart: true,
      });

      const updates: DeviceInfo[][] = [];
      manager.on('devices-updated', (d) => updates.push(d));

      await vi.advanceTimersByTimeAsync(10);
      expect(updates).toHaveLength(1);
      expect(updates[0][0].battery.level).toBe(85);

      // Simulate battery drain from 85% to 80%
      mockAdb.simulateBatteryUpdate(MOCK_SAMSUNG_S24.raw.serial, { level: 80 });

      // Before 10s elapses, no update is emitted
      await vi.advanceTimersByTimeAsync(4000);
      expect(updates).toHaveLength(1);

      // Once 10s interval elapses
      await vi.advanceTimersByTimeAsync(6000);
      expect(updates).toHaveLength(2);
      expect(updates[1][0].battery.level).toBe(80);
    });
  });

  describe('Device State Transitions & Degraded States', () => {
    it('handles unauthorized device without executing shell commands', async () => {
      mockAdb.reset([MOCK_SAMSUNG_S24]);
      mockAdb.simulateDeviceState(MOCK_SAMSUNG_S24.raw.serial, 'unauthorized');

      const getPropSpy = vi.spyOn(mockAdb, 'getProp');
      const getBatterySpy = vi.spyOn(mockAdb, 'getBatteryInfo');

      manager = new DeviceManager(mockAdb, { pollIntervalMs: 2000, autoStart: true });
      await vi.advanceTimersByTimeAsync(10);

      // Zero getProp and getBatteryInfo queries allowed for unauthorized devices
      expect(getPropSpy).toHaveBeenCalledTimes(0);
      expect(getBatterySpy).toHaveBeenCalledTimes(0);

      const dev = manager.getDeviceBySerial(MOCK_SAMSUNG_S24.raw.serial);
      expect(dev).toBeDefined();
      expect(dev?.state).toBe('unauthorized');
      expect(dev?.brand).toBe('generic');
      expect(dev?.manufacturer).toBe('unknown');
    });

    it('fetches properties when device transitions from unauthorized to device', async () => {
      mockAdb.reset([MOCK_SAMSUNG_S24]);
      mockAdb.simulateDeviceState(MOCK_SAMSUNG_S24.raw.serial, 'unauthorized');

      manager = new DeviceManager(mockAdb, { pollIntervalMs: 2000, autoStart: true });
      await vi.advanceTimersByTimeAsync(10);

      expect(manager.getDevices()[0].state).toBe('unauthorized');

      // User accepts USB debugging prompt
      mockAdb.simulateDeviceState(MOCK_SAMSUNG_S24.raw.serial, 'device');

      await vi.advanceTimersByTimeAsync(2000);

      const authorized = manager.getDevices()[0];
      expect(authorized.state).toBe('device');
      expect(authorized.brand).toBe('samsung');
      expect(authorized.manufacturer).toBe('samsung');
      expect(authorized.battery.level).toBe(85);
    });
  });

  describe('Clean Shutdown, Backoff & Error Resilience', () => {
    it('stop cancels polling loop and prevents further ticks', async () => {
      mockAdb.reset([MOCK_SAMSUNG_S24]);
      const getDevicesSpy = vi.spyOn(mockAdb, 'getDevices');
      manager = new DeviceManager(mockAdb, { pollIntervalMs: 2000, autoStart: true });

      await vi.advanceTimersByTimeAsync(10);
      expect(getDevicesSpy).toHaveBeenCalledTimes(1);

      manager.stop();
      expect(manager.isStarted()).toBe(false);

      // Advance through multiple intervals
      await vi.advanceTimersByTimeAsync(10000);

      // No further getDevices calls
      expect(getDevicesSpy).toHaveBeenCalledTimes(1);
    });

    it('dispose clears caches, listeners, and resets device snapshot', async () => {
      mockAdb.reset([MOCK_SAMSUNG_S24]);
      manager = new DeviceManager(mockAdb, { pollIntervalMs: 2000, autoStart: true });

      await vi.advanceTimersByTimeAsync(10);
      expect(manager.getDevices()).toHaveLength(1);
      expect(manager.getCacheSize()).toBe(1);

      manager.dispose();

      expect(manager.isStarted()).toBe(false);
      expect(manager.getDevices()).toEqual([]);
      expect(manager.getCacheSize()).toBe(0);
      expect(manager.listenerCount('devices-updated')).toBe(0);
    });

    it('applies exponential backoff on consecutive ADB errors and recovers on success', async () => {
      mockAdb.reset([]);
      const errors: unknown[] = [];
      const adbSpy = vi.spyOn(mockAdb, 'getDevices');

      manager = new DeviceManager(mockAdb, {
        pollIntervalMs: 2000,
        maxBackoffMs: 10000,
        autoStart: true,
      });

      manager.on('error', (err) => errors.push(err));

      // Initial tick succeeds
      await vi.advanceTimersByTimeAsync(10);
      expect(adbSpy).toHaveBeenCalledTimes(1);

      // Force failure on tick 2
      adbSpy.mockRejectedValueOnce(new Error('ADB daemon died'));
      await vi.advanceTimersByTimeAsync(2000);
      expect(errors).toHaveLength(1);

      // Tick 3: backoff applied (2000 * 1.5 = 3000ms delay from tick 2)
      adbSpy.mockResolvedValueOnce([]);
      await vi.advanceTimersByTimeAsync(2000);
      expect(adbSpy).toHaveBeenCalledTimes(2); // At 2000ms, tick 3 has NOT fired yet (delay is 3000ms)

      await vi.advanceTimersByTimeAsync(1000); // Fires once 3000ms delay has elapsed
      expect(adbSpy).toHaveBeenCalledTimes(3);

      // Successful tick resets backoff delay back to 2000ms
      await vi.advanceTimersByTimeAsync(2000);
      expect(adbSpy).toHaveBeenCalledTimes(4);
    });

    it('returns immutably cloned objects from getDevices to prevent cache pollution', async () => {
      mockAdb.reset([MOCK_SAMSUNG_S24]);
      manager = new DeviceManager(mockAdb, { pollIntervalMs: 2000, autoStart: true });

      await vi.advanceTimersByTimeAsync(10);

      const devs = manager.getDevices();
      expect(devs[0].battery.level).toBe(85);

      // Attempt to mutate returned object
      devs[0].battery.level = 0;

      // Internal snapshot must remain untouched
      const freshDevs = manager.getDevices();
      expect(freshDevs[0].battery.level).toBe(85);
    });

    it('falls back gracefully when property or battery queries reject', async () => {
      mockAdb.reset([MOCK_SAMSUNG_S24]);
      vi.spyOn(mockAdb, 'getProp').mockRejectedValue(new Error('Property read timeout'));
      vi.spyOn(mockAdb, 'getBatteryInfo').mockRejectedValue(new Error('Dumpsys failed'));

      manager = new DeviceManager(mockAdb, { pollIntervalMs: 2000, autoStart: true });
      await vi.advanceTimersByTimeAsync(10);

      const devs = manager.getDevices();
      expect(devs).toHaveLength(1);
      expect(devs[0].brand).toBe('generic');
      expect(devs[0].manufacturer).toBe('generic');
      expect(devs[0].androidVersion).toBe('14');
      expect(devs[0].battery.level).toBe(100);
    });

    it('deduplicates concurrent refresh invocations', async () => {
      mockAdb.reset([MOCK_SAMSUNG_S24]);
      const getDevicesSpy = vi.spyOn(mockAdb, 'getDevices');
      manager = new DeviceManager(mockAdb, { pollIntervalMs: 2000, autoStart: false });

      // Run 3 refresh calls concurrently
      const [res1, res2, res3] = await Promise.all([
        manager.refresh(),
        manager.refresh(),
        manager.refresh(),
      ]);

      expect(getDevicesSpy).toHaveBeenCalledTimes(1);
      expect(res1).toHaveLength(1);
      expect(res2).toEqual(res1);
      expect(res3).toEqual(res1);
    });

    it('is idempotent on multiple start() invocations', async () => {
      mockAdb.reset([MOCK_SAMSUNG_S24]);
      const getDevicesSpy = vi.spyOn(mockAdb, 'getDevices');
      manager = new DeviceManager(mockAdb, { pollIntervalMs: 2000, autoStart: false });

      manager.start();
      manager.start();
      manager.start();

      await vi.advanceTimersByTimeAsync(10);
      expect(getDevicesSpy).toHaveBeenCalledTimes(1);
    });

    it('returns undefined for non-existent serial in getDeviceBySerial', async () => {
      mockAdb.reset([MOCK_SAMSUNG_S24]);
      manager = new DeviceManager(mockAdb, { pollIntervalMs: 2000, autoStart: true });
      await vi.advanceTimersByTimeAsync(10);

      expect(manager.getDeviceBySerial('NON_EXISTENT')).toBeUndefined();
    });

    it('does not throw or trigger unhandled rejection when ADB fails and no error listener is registered', async () => {
      mockAdb.reset([]);
      const adbSpy = vi.spyOn(mockAdb, 'getDevices');
      manager = new DeviceManager(mockAdb, { pollIntervalMs: 2000, autoStart: true });

      // No 'error' listener registered on manager!
      expect(manager.listenerCount('error')).toBe(0);

      // Force ADB failure during background tick
      adbSpy.mockRejectedValueOnce(new Error('Command failed: /opt/homebrew/bin/adb devices -l'));

      // Advance timers to trigger poll tick
      await vi.advanceTimersByTimeAsync(2000);

      // Should not throw or crash; manager returns cached empty list
      expect(manager.getDevices()).toEqual([]);

      // Manual refresh also resolves safely without rejecting
      adbSpy.mockRejectedValueOnce(new Error('Transient USB disconnect'));
      const refreshResult = await manager.refresh();
      expect(refreshResult).toEqual([]);
    });
  });
});

