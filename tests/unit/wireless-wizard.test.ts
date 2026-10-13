import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';

// Mock electron ipcMain before any imports of handlers
const ipcHandlers = new Map<string, (...args: any[]) => any>();
vi.mock('electron', () => ({
  ipcMain: {
    handle: vi.fn((channel: string, handler: any) => {
      ipcHandlers.set(channel, handler);
    }),
    removeHandler: vi.fn((channel: string) => {
      ipcHandlers.delete(channel);
    }),
  },
}));

import {
  WirelessWizard,
  validatePairingPin,
  validatePort,
  validateIpAddress,
  formatDeviceAddress,
  parseDeviceAddress,
  parseConnectOutput,
} from '../../electron/main/services/WirelessWizard';
import {
  RecentDevicesStore,
  InMemoryRecentDevicesStorage,
  JsonFileRecentDevicesStorage,
} from '../../electron/main/services/RecentDevicesStore';
import { MockAdbExecutor } from '../../electron/main/adapters/MockAdbExecutor';
import { MockScrcpyRunner } from '../../electron/main/adapters/MockScrcpyRunner';
import { DEFAULT_MOCK_DEVICES, MOCK_SAMSUNG_S24 } from '../fixtures/mockDevices';
import { DEXCONNECT_CHANNELS } from '../../electron/main/ipc/channels';
import { registerIpcHandlers } from '../../electron/main/ipc/handlers';
import type { PairWirelessPayload } from '../../src/types';

describe('WirelessWizard Unit Tests', () => {
  let mockAdb: MockAdbExecutor;
  let wizard: WirelessWizard;

  beforeEach(() => {
    vi.useFakeTimers();
    mockAdb = new MockAdbExecutor(DEFAULT_MOCK_DEVICES);
    wizard = new WirelessWizard(mockAdb, { delayMs: 0 });
  });

  afterEach(() => {
    if (wizard) {
      wizard.dispose();
    }
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  // =========================================================================
  // Suite 1: Pure Validation & Helper Functions
  // =========================================================================
  describe('Suite 1: Validation and Helper Functions', () => {
    it('validatePairingPin accepts exactly 6 numeric digits', () => {
      expect(validatePairingPin('123456')).toEqual({ valid: true });
      expect(validatePairingPin('012345')).toEqual({ valid: true });
      expect(validatePairingPin('999999')).toEqual({ valid: true });
    });

    it('validatePairingPin rejects invalid PIN formats', () => {
      expect(validatePairingPin('12345').valid).toBe(false); // 5 digits
      expect(validatePairingPin('1234567').valid).toBe(false); // 7 digits
      expect(validatePairingPin('abcdef').valid).toBe(false); // letters
      expect(validatePairingPin('12345a').valid).toBe(false); // alphanumeric
      expect(validatePairingPin('').valid).toBe(false); // empty
      expect(validatePairingPin('      ').valid).toBe(false); // whitespace
      expect(validatePairingPin('000000').valid).toBe(false); // disallowed test code
    });

    it('validatePort accepts valid TCP ports (1-65535)', () => {
      expect(validatePort(5555)).toEqual({ valid: true });
      expect(validatePort(38192)).toEqual({ valid: true });
      expect(validatePort(1)).toEqual({ valid: true });
      expect(validatePort(65535)).toEqual({ valid: true });
    });

    it('validatePort rejects out-of-bounds or non-integer ports', () => {
      expect(validatePort(0).valid).toBe(false);
      expect(validatePort(-1).valid).toBe(false);
      expect(validatePort(65536).valid).toBe(false);
      expect(validatePort(70000).valid).toBe(false);
      expect(validatePort(NaN).valid).toBe(false);
      expect(validatePort(5555.5).valid).toBe(false);
    });

    it('validateIpAddress validates IPv4 address strings', () => {
      expect(validateIpAddress('192.168.1.101')).toEqual({ valid: true });
      expect(validateIpAddress('10.0.0.5')).toEqual({ valid: true });
      expect(validateIpAddress('127.0.0.1')).toEqual({ valid: true });
      expect(validateIpAddress('256.1.1.1').valid).toBe(false);
      expect(validateIpAddress('not-an-ip').valid).toBe(false);
      expect(validateIpAddress('').valid).toBe(false);
    });

    it('formatDeviceAddress and parseDeviceAddress format and parse correctly', () => {
      expect(formatDeviceAddress('192.168.1.101', 5555)).toBe('192.168.1.101:5555');
      expect(formatDeviceAddress('192.168.1.101')).toBe('192.168.1.101:5555');
      expect(parseDeviceAddress('192.168.1.101:5555')).toEqual({
        ip: '192.168.1.101',
        port: 5555,
      });
      expect(parseDeviceAddress('192.168.1.101')).toEqual({
        ip: '192.168.1.101',
        port: 5555,
      });
    });

    it('parseConnectOutput distinguishes connection success vs exit code 0 failures', () => {
      expect(parseConnectOutput('connected to 192.168.1.101:5555')).toEqual({ success: true });
      expect(parseConnectOutput('already connected to 192.168.1.101:5555')).toEqual({ success: true });

      const failRefused = parseConnectOutput('failed to connect to 127.0.0.1:55555: Connection refused');
      expect(failRefused.success).toBe(false);
      expect(failRefused.reason).toContain('Connection refused');

      const failTimeout = parseConnectOutput('cannot connect to 10.0.0.1:5555: Operation timed out');
      expect(failTimeout.success).toBe(false);
      expect(failTimeout.reason).toContain('timed out');
    });
  });

  // =========================================================================
  // Suite 2: 1-Click USB-to-Wi-Fi Migration
  // =========================================================================
  describe('Suite 2: 1-Click USB-to-Wi-Fi Migration Flow', () => {
    it('successfully migrates a connected USB device to Wi-Fi', async () => {
      const serial = 'R5CW10ABCDE'; // Samsung device in mock fixtures with ip 192.168.1.101
      const result = await wizard.migrateToWifi(serial);

      expect(result.success).toBe(true);
      expect(result.ip).toBe('192.168.1.101');
      expect(result.error).toBeUndefined();

      // Assert device is now visible as a wireless ADB endpoint
      const devices = await mockAdb.getDevices();
      expect(devices.some((d) => d.serial === '192.168.1.101:5555')).toBe(true);

      // Assert added to recent devices
      const recents = wizard.getRecentDevices();
      expect(recents.some((r) => r.ip === '192.168.1.101' && r.port === 5555)).toBe(true);
    });

    it('rejects migration if device serial is not found', async () => {
      const result = await wizard.migrateToWifi('NON_EXISTENT_SERIAL');
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/not found/i);
    });

    it('rejects migration if device has no IP address', async () => {
      // Connect a USB device without IP
      mockAdb.simulateDeviceConnect({
        raw: { serial: 'USB_NO_IP', state: 'device' },
        props: { 'ro.product.model': 'No-IP Phone' },
        battery: { level: 50, scale: 100, status: 2, isCharging: true, powerSource: 'usb' },
        ipAddress: null,
        tcpipPort: null,
      });

      const result = await wizard.migrateToWifi('USB_NO_IP');
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/IP address/i);
    });

    it('rejects migration if device is already connected via Wi-Fi', async () => {
      const wifiSerial = '192.168.1.103:5555';
      const result = await wizard.migrateToWifi(wifiSerial);
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/already connected via Wi-Fi/i);
    });

    it('rejects migration if device is unauthorized', async () => {
      mockAdb.simulateDeviceConnect({
        raw: { serial: 'UNAUTH_DEVICE', state: 'unauthorized' },
        props: {},
        battery: { level: 50, scale: 100, status: 2, isCharging: true, powerSource: 'usb' },
        ipAddress: '192.168.1.105',
        tcpipPort: null,
      });

      const result = await wizard.migrateToWifi('UNAUTH_DEVICE');
      expect(result.success).toBe(false);
      expect(result.errorCode).toBe('E_DEVICE_UNAUTHORIZED');
      expect(result.error).toMatch(/unauthorized/i);
    });

    it('rejects migration if device is offline', async () => {
      mockAdb.simulateDeviceConnect({
        raw: { serial: 'OFFLINE_DEVICE', state: 'offline' },
        props: {},
        battery: { level: 50, scale: 100, status: 2, isCharging: true, powerSource: 'usb' },
        ipAddress: '192.168.1.106',
        tcpipPort: null,
      });

      const result = await wizard.migrateToWifi('OFFLINE_DEVICE');
      expect(result.success).toBe(false);
      expect(result.errorCode).toBe('E_DEVICE_OFFLINE');
      expect(result.error).toMatch(/offline/i);
    });

    it('handles failure when adb switchTcpip fails', async () => {
      vi.spyOn(mockAdb, 'switchTcpip').mockResolvedValueOnce({
        success: false,
        output: 'error: closed',
      });

      const result = await wizard.migrateToWifi('R5CW10ABCDE');
      expect(result.success).toBe(false);
      expect(result.error).toContain('error: closed');
    });

    it('handles failure when adb connect fails', async () => {
      vi.spyOn(mockAdb, 'connect').mockResolvedValue({
        success: false,
        output: 'failed to connect to 192.168.1.101:5555: Connection refused',
      });

      const result = await wizard.migrateToWifi('R5CW10ABCDE');
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/Connection refused/i);
    });

    it('handles operation timeout guard with E_TIMEOUT', async () => {
      vi.spyOn(mockAdb, 'connect').mockImplementationOnce(() => new Promise(() => {}));

      const promise = wizard.migrateToWifi('R5CW10ABCDE', { timeoutMs: 50 });
      await vi.advanceTimersByTimeAsync(50);
      const result = await promise;

      expect(result.success).toBe(false);
      expect(result.errorCode).toBe('E_TIMEOUT');
      expect(result.error).toMatch(/timed out/i);
    });

    it('emits migration-progress events across all lifecycle stages', async () => {
      const reportedSteps: string[] = [];
      wizard.on('migration-progress', (p) => {
        reportedSteps.push(p.step);
      });

      const result = await wizard.migrateToWifi('R5CW10ABCDE');
      expect(result.success).toBe(true);

      expect(reportedSteps).toContain('VALIDATING');
      expect(reportedSteps).toContain('RESOLVING_IP');
      expect(reportedSteps).toContain('SWITCHING_TCPIP');
      expect(reportedSteps).toContain('WAITING_DAEMON');
      expect(reportedSteps).toContain('CONNECTING');
      expect(reportedSteps).toContain('VERIFYING');
      expect(reportedSteps).toContain('COMPLETED');
    });
  });

  // =========================================================================
  // Suite 3: Android 11+ Wireless Debugging Pairing
  // =========================================================================
  describe('Suite 3: Android 11+ Wireless Debugging Pairing Flow', () => {
    it('successfully pairs device with 6-digit PIN and connects to port 5555', async () => {
      const ip = '192.168.1.101';
      const pairingPort = 38192;
      const code = '123456';

      const result = await wizard.pairDevice(ip, pairingPort, code);

      expect(result.success).toBe(true);
      expect(result.paired).toBe(true);
      expect(result.connected).toBe(true);
      expect(result.error).toBeUndefined();

      // Verify device was connected wirelessly
      const devices = await mockAdb.getDevices();
      expect(devices.some((d) => d.serial === `${ip}:5555`)).toBe(true);

      // Verify saved in recent devices
      const recents = wizard.getRecentDevices();
      expect(recents.some((r) => r.ip === ip && r.port === 5555)).toBe(true);
    });

    it('successfully pairs device and connects to custom connection port', async () => {
      const ip = '192.168.1.101';
      const pairingPort = 38192;
      const code = '123456';
      const connectPort = 42111;

      const result = await wizard.pairDevice(ip, pairingPort, code, connectPort);

      expect(result.success).toBe(true);
      expect(result.paired).toBe(true);
      expect(result.connected).toBe(true);

      const devices = await mockAdb.getDevices();
      expect(devices.some((d) => d.serial === `${ip}:${connectPort}`)).toBe(true);
    });

    it('supports object payload parameter for pairDevice', async () => {
      const payload: PairWirelessPayload = {
        ip: '192.168.1.101',
        pairingPort: 38192,
        code: '123456',
        connectPort: 5555,
      };

      const result = await wizard.pairDevice(payload);
      expect(result.success).toBe(true);
      expect(result.paired).toBe(true);
    });

    it('rejects invalid PIN formats synchronously without network calls', async () => {
      const pairSpy = vi.spyOn(mockAdb, 'pair');

      const invalidPins = ['12345', '1234567', 'abcdef', '1234a5', '', '000000'];
      for (const pin of invalidPins) {
        const res = await wizard.pairDevice('192.168.1.101', 38192, pin);
        expect(res.success).toBe(false);
        expect(res.error).toMatch(/code|PIN/i);
      }

      // Assert pair() was NEVER called on the adapter
      expect(pairSpy).not.toHaveBeenCalled();
    });

    it('rejects invalid pairing ports and connect ports', async () => {
      const invalidPairingPort = await wizard.pairDevice('192.168.1.101', 0, '123456');
      expect(invalidPairingPort.success).toBe(false);
      expect(invalidPairingPort.error).toMatch(/port/i);

      const invalidConnectPort = await wizard.pairDevice('192.168.1.101', 38192, '123456', 70000);
      expect(invalidConnectPort.success).toBe(false);
      expect(invalidConnectPort.error).toMatch(/port/i);
    });

    it('handles failure when adb pair returns error', async () => {
      vi.spyOn(mockAdb, 'pair').mockResolvedValueOnce({
        success: false,
        output: 'Failed: Wrong password or connection closed.',
      });

      const result = await wizard.pairDevice('192.168.1.101', 38192, '123456');
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/Wrong password/i);
    });

    it('handles failure when pairing succeeds but subsequent connect fails', async () => {
      // Unknown IP in mock adb causes connect to fail
      const result = await wizard.pairDevice('192.168.1.250', 38192, '123456', 5555);
      expect(result.success).toBe(false);
      expect(result.paired).toBe(true);
      expect(result.connected).toBe(false);
      expect(result.error).toMatch(/Connection refused/i);
    });
  });

  // =========================================================================
  // Suite 4: Direct Wireless Connect & Disconnect
  // =========================================================================
  describe('Suite 4: Direct Wireless Connect and Disconnect', () => {
    it('connectWireless connects via IP and port', async () => {
      const result = await wizard.connectWireless('192.168.1.101', 5555);
      expect(result.success).toBe(true);

      const devices = await mockAdb.getDevices();
      expect(devices.some((d) => d.serial === '192.168.1.101:5555')).toBe(true);
    });

    it('connectWireless connects via formatted address string', async () => {
      const result = await wizard.connectWireless('192.168.1.101:5555');
      expect(result.success).toBe(true);
    });

    it('connectWireless fails gracefully on unreachable target', async () => {
      const result = await wizard.connectWireless('192.168.1.240:5555');
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/Connection refused/i);
    });

    it('disconnectWireless disconnects a specific connected wireless device', async () => {
      // Connect first
      await wizard.connectWireless('192.168.1.101:5555');

      // Now disconnect
      const result = await wizard.disconnectWireless('192.168.1.101:5555');
      expect(result.success).toBe(true);

      const devices = await mockAdb.getDevices();
      expect(devices.some((d) => d.serial === '192.168.1.101:5555')).toBe(false);
    });

    it('disconnectWireless disconnects all wireless devices when address omitted', async () => {
      await wizard.connectWireless('192.168.1.101:5555');
      const result = await wizard.disconnectWireless();
      expect(result.success).toBe(true);

      const devices = await mockAdb.getDevices();
      expect(devices.some((d) => d.serial.includes(':'))).toBe(false);
    });
  });

  // =========================================================================
  // Suite 5: Recent Devices Store & Deduplication
  // =========================================================================
  describe('Suite 5: Recent Devices Store and Deduplication', () => {
    it('records connected devices into recent list', async () => {
      expect(wizard.getRecentDevices()).toHaveLength(0);

      await wizard.connectWireless('192.168.1.101', 5555);
      const recents = wizard.getRecentDevices();
      expect(recents).toHaveLength(1);
      expect(recents[0].ip).toBe('192.168.1.101');
      expect(recents[0].port).toBe(5555);
    });

    it('deduplicates recent devices and promotes to top upon reconnection', async () => {
      await wizard.connectWireless('192.168.1.101', 5555);
      await wizard.connectWireless('192.168.1.102', 5555);

      let recents = wizard.getRecentDevices();
      expect(recents).toHaveLength(2);
      expect(recents[0].ip).toBe('192.168.1.102'); // Most recent first

      // Reconnect first device
      await wizard.connectWireless('192.168.1.101', 5555);
      recents = wizard.getRecentDevices();
      expect(recents).toHaveLength(2); // Still 2 items!
      expect(recents[0].ip).toBe('192.168.1.101'); // Promoted to top
    });

    it('caps recent devices store at max limit and evicts oldest', async () => {
      const cappedWizard = new WirelessWizard(mockAdb, { delayMs: 0, maxRecentDevices: 2 });

      cappedWizard.addRecentDevice({ ip: '192.168.1.1', port: 5555, model: 'Dev 1', lastSeen: 1 });
      cappedWizard.addRecentDevice({ ip: '192.168.1.2', port: 5555, model: 'Dev 2', lastSeen: 2 });
      cappedWizard.addRecentDevice({ ip: '192.168.1.3', port: 5555, model: 'Dev 3', lastSeen: 3 });

      const recents = cappedWizard.getRecentDevices();
      expect(recents).toHaveLength(2);
      expect(recents.map((r) => r.ip)).toEqual(['192.168.1.3', '192.168.1.2']);
      cappedWizard.dispose();
    });

    it('allows manual removal and clearing of recent devices', async () => {
      wizard.addRecentDevice({ ip: '192.168.1.101', port: 5555, model: 'Phone 1', lastSeen: 1 });
      wizard.addRecentDevice({ ip: '192.168.1.102', port: 5555, model: 'Phone 2', lastSeen: 2 });

      const removed = wizard.removeRecentDevice('192.168.1.101:5555');
      expect(removed).toBe(true);
      expect(wizard.getRecentDevices()).toHaveLength(1);

      wizard.clearRecentDevices();
      expect(wizard.getRecentDevices()).toHaveLength(0);
    });

    it('persists and recovers recent devices across JsonFileRecentDevicesStorage sessions', async () => {
      const tmpFile = path.join(os.tmpdir(), `dexconnect-test-recents-${Date.now()}.json`);
      const storage = new JsonFileRecentDevicesStorage(tmpFile);
      const store1 = new RecentDevicesStore({ storage, maxRecentDevices: 5 });

      store1.addRecentDevice({ ip: '192.168.1.201', port: 5555, name: 'File Persisted Galaxy', brand: 'samsung' });
      store1.addRecentDevice({ ip: '192.168.1.202', port: 5555, name: 'File Persisted Moto', brand: 'motorola' });

      expect(store1.size()).toBe(2);

      // Verify file was written
      expect(fs.existsSync(tmpFile)).toBe(true);
      const loadedFromFile = await storage.load();
      expect(loadedFromFile).toHaveLength(2);

      // Create new store instance pointing to same file
      const store2 = new RecentDevicesStore({ storage: new JsonFileRecentDevicesStorage(tmpFile) });
      const devices = store2.getRecentDevices();
      expect(devices.length).toBe(2);
      expect(devices[0].name).toBe('File Persisted Moto');
      expect(devices[1].name).toBe('File Persisted Galaxy');

      // Clean up temp file
      if (fs.existsSync(tmpFile)) {
        fs.unlinkSync(tmpFile);
      }
    });
  });

  // =========================================================================
  // Suite 6: Timing & Daemon Stabilization
  // =========================================================================
  describe('Suite 6: Timing and Daemon Stabilization', () => {
    it('respects delayMs stabilization before invoking connect', async () => {
      const timedWizard = new WirelessWizard(mockAdb, { delayMs: 500 });
      const connectSpy = vi.spyOn(mockAdb, 'connect');

      const promise = timedWizard.migrateToWifi('R5CW10ABCDE');

      // Before timer ticks 500ms, connect should not have been called yet
      expect(connectSpy).not.toHaveBeenCalled();

      // Fast-forward 500ms
      await vi.advanceTimersByTimeAsync(500);
      const res = await promise;

      expect(connectSpy).toHaveBeenCalled();
      expect(res.success).toBe(true);
      timedWizard.dispose();
    });
  });

  // =========================================================================
  // Suite 7: IPC Handler Integration
  // =========================================================================
  describe('Suite 7: IPC Handler Integration', () => {
    let mockScrcpy: MockScrcpyRunner;

    beforeEach(() => {
      mockScrcpy = new MockScrcpyRunner();
      registerIpcHandlers({
        adb: mockAdb,
        scrcpy: mockScrcpy,
        wirelessWizard: wizard,
      });
    });

    it('MIGRATE_WIRELESS handler delegates to wirelessWizard.migrateToWifi', async () => {
      const handler = ipcHandlers.get(DEXCONNECT_CHANNELS.MIGRATE_WIRELESS);
      expect(handler).toBeDefined();

      const result = await handler!({} as any, 'R5CW10ABCDE');
      expect(result.success).toBe(true);
      expect(result.ip).toBe('192.168.1.101');
    });

    it('PAIR_WIRELESS_DEVICE handler delegates to wirelessWizard.pairDevice', async () => {
      const handler = ipcHandlers.get(DEXCONNECT_CHANNELS.PAIR_WIRELESS_DEVICE);
      expect(handler).toBeDefined();

      const payload: PairWirelessPayload = {
        ip: '192.168.1.101',
        pairingPort: 38192,
        code: '123456',
        connectPort: 5555,
      };

      const result = await handler!({} as any, payload);
      expect(result.success).toBe(true);
    });

    it('CONNECT_WIRELESS_DEVICE handler delegates to wirelessWizard.connectWireless', async () => {
      const handler = ipcHandlers.get(DEXCONNECT_CHANNELS.CONNECT_WIRELESS_DEVICE);
      expect(handler).toBeDefined();

      const result = await handler!({} as any, '192.168.1.101:5555');
      expect(result.success).toBe(true);
    });

    it('DISCONNECT_WIRELESS handler delegates to wirelessWizard.disconnectWireless', async () => {
      const handler = ipcHandlers.get(DEXCONNECT_CHANNELS.DISCONNECT_WIRELESS);
      expect(handler).toBeDefined();

      await wizard.connectWireless('192.168.1.101:5555');
      const result = await handler!({} as any, '192.168.1.101:5555');
      expect(result.success).toBe(true);
    });

    it('GET_RECENT_WIRELESS_DEVICES handler delegates to wirelessWizard.getRecentDevices', async () => {
      const handler = ipcHandlers.get(DEXCONNECT_CHANNELS.GET_RECENT_WIRELESS_DEVICES);
      expect(handler).toBeDefined();

      await wizard.connectWireless('192.168.1.101:5555');
      const recents = await handler!({} as any);
      expect(recents).toHaveLength(1);
      expect(recents[0].ip).toBe('192.168.1.101');
    });
  });
});
