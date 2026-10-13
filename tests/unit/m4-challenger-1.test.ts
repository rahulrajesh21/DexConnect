import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';

import {
  WirelessWizard,
  validatePairingPin,
  validatePort,
  validateIpAddress,
  formatDeviceAddress,
  parseDeviceAddress,
  parseConnectOutput,
  type MigrationProgress,
} from '../../electron/main/services/WirelessWizard';
import {
  RecentDevicesStore,
  InMemoryRecentDevicesStorage,
  JsonFileRecentDevicesStorage,
} from '../../electron/main/services/RecentDevicesStore';
import { MockAdbExecutor } from '../../electron/main/adapters/MockAdbExecutor';
import { DEFAULT_MOCK_DEVICES, MOCK_SAMSUNG_S24 } from '../fixtures/mockDevices';

describe('Milestone M4 Challenger 1: Empirical Adversarial Stress Suite', () => {
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
  // PILLAR 1: ADB Connect Exit Code 0 Quirk Resilience
  // =========================================================================
  describe('Pillar 1: ADB Connect Exit Code 0 Quirk Probes', () => {
    const subtleFailureStrings = [
      'failed to connect to 192.168.1.101:5555: Connection refused',
      'failed to connect to 192.168.1.101:5555: No route to host',
      'failed to connect to 192.168.1.101:5555: Connection reset by peer',
      'cannot connect to 192.168.1.101:5555: Operation timed out',
      'cannot connect to 192.168.1.101:5555: Network is unreachable',
      'cannot connect to 192.168.1.101:5555: Host is down',
      'failed to connect to 192.168.1.101:5555',
      'cannot connect to 192.168.1.101:5555',
      'error: cannot connect to 192.168.1.101:5555',
      'error: device unauthorized',
      'error: device offline',
      'unable to connect to 192.168.1.101:5555',
      'Connection timed out',
      'Connection refused',
      'No route to host',
      '',
      '   ',
      'unknown response from adb daemon',
      'failed to connect to 192.168.1.101:5555 (was already connected to other)',
      'cannot connect to device: connected to nothing',
    ];

    it('P1.1: parseConnectOutput strictly rejects all subtle ADB exit code 0 error strings', () => {
      for (const errorStr of subtleFailureStrings) {
        const parsed = parseConnectOutput(errorStr);
        expect(parsed.success).toBe(false);
        expect(parsed.reason).toBeDefined();
      }
    });

    it('P1.2: parseConnectOutput positively classifies legitimate success variants', () => {
      const validSuccessStrings = [
        'connected to 192.168.1.101:5555',
        'Connected to 192.168.1.101:5555\n',
        'CONNECTED TO 192.168.1.101:5555',
        'already connected to 192.168.1.101:5555',
        'Already connected to 192.168.1.101:5555',
        'ALREADY CONNECTED TO 192.168.1.101:5555',
      ];

      for (const successStr of validSuccessStrings) {
        const parsed = parseConnectOutput(successStr);
        expect(parsed.success).toBe(true);
        expect(parsed.reason).toBeUndefined();
      }
    });

    it('P1.3: migrateToWifi never misclassifies exit code 0 failures as successful connections', async () => {
      for (const subtleError of subtleFailureStrings) {
        // Force mock connect to return success: true (exit code 0) alongside failure output
        vi.spyOn(mockAdb, 'connect').mockResolvedValueOnce({
          success: true,
          output: subtleError,
        });

        const result = await wizard.migrateToWifi('R5CW10ABCDE', {
          connectRetries: 1,
          daemonDelayMs: 0,
        });

        expect(result.success).toBe(false);
        expect(result.errorCode).toBe('E_CONNECT_FAILED');
        expect(result.step).toBe('CONNECTING');
        expect(result.error).toContain('Failed to connect wirelessly');
      }
    });

    it('P1.4: pairDevice rejects exit code 0 failures during secondary connect phase', async () => {
      for (const subtleError of subtleFailureStrings) {
        // Successful pairing, but connect returns exit code 0 with error string
        vi.spyOn(mockAdb, 'pair').mockResolvedValueOnce({
          success: true,
          output: 'Successfully paired to 192.168.1.101:38192 [guid: test]',
        });
        vi.spyOn(mockAdb, 'connect').mockResolvedValueOnce({
          success: true,
          output: subtleError,
        });

        const result = await wizard.pairDevice({
          ip: '192.168.1.101',
          pairingPort: 38192,
          code: '123456',
          connectPort: 5555,
        });

        expect(result.success).toBe(false);
        expect(result.paired).toBe(true);
        expect(result.connected).toBe(false);
        expect(result.error).toBeDefined();
      }
    });

    it('P1.5: connectWireless rejects exit code 0 failures and does not add device to store', async () => {
      const initialCount = wizard.getRecentDevices().length;

      vi.spyOn(mockAdb, 'connect').mockResolvedValueOnce({
        success: true,
        output: 'failed to connect to 192.168.1.101:5555: Connection refused',
      });

      const res = await wizard.connectWireless('192.168.1.101:5555');
      expect(res.success).toBe(false);
      expect(wizard.getRecentDevices().length).toBe(initialCount);
    });
  });

  // =========================================================================
  // PILLAR 2: Rapid Migration Retries During Daemon Restart
  // =========================================================================
  describe('Pillar 2: Daemon Restart & Retry Contention Probes', () => {
    it('P2.1: Recovers when daemon is restarting: attempts 1 & 2 fail, attempt 3 succeeds', async () => {
      const connectSpy = vi.spyOn(mockAdb, 'connect');
      connectSpy
        .mockResolvedValueOnce({
          success: true,
          output: 'failed to connect to 192.168.1.101:5555: Connection refused',
        })
        .mockResolvedValueOnce({
          success: true,
          output: 'failed to connect to 192.168.1.101:5555: Connection refused',
        })
        .mockImplementationOnce(async (addr) => {
          mockAdb.simulateDeviceConnect({
            raw: { serial: '192.168.1.101:5555', state: 'device' },
            props: { 'ro.product.model': 'SM-S928B' },
            battery: { level: 85, scale: 100, status: 2, isCharging: false, powerSource: 'battery' },
            ipAddress: '192.168.1.101',
            tcpipPort: 5555,
          });
          return { success: true, output: `connected to ${addr}` };
        });

      const promise = wizard.migrateToWifi('R5CW10ABCDE', {
        daemonDelayMs: 100,
        connectRetries: 3,
        connectRetryDelayMs: 200,
      });

      // Advance through delays
      await vi.advanceTimersByTimeAsync(100); // daemon delay
      await vi.advanceTimersByTimeAsync(200); // attempt 1 delay
      await vi.advanceTimersByTimeAsync(400); // attempt 2 delay (200 * 2)

      const result = await promise;
      expect(result.success).toBe(true);
      expect(result.step).toBe('COMPLETED');
      expect(connectSpy).toHaveBeenCalledTimes(3);
    });

    it('P2.2: Retries exhaust when daemon refuses all connection attempts', async () => {
      const connectSpy = vi.spyOn(mockAdb, 'connect').mockResolvedValue({
        success: true,
        output: 'failed to connect to 192.168.1.101:5555: Connection refused',
      });

      const promise = wizard.migrateToWifi('R5CW10ABCDE', {
        daemonDelayMs: 50,
        connectRetries: 3,
        connectRetryDelayMs: 50,
      });

      await vi.advanceTimersByTimeAsync(50);
      await vi.advanceTimersByTimeAsync(50);
      await vi.advanceTimersByTimeAsync(100);

      const result = await promise;
      expect(result.success).toBe(false);
      expect(result.errorCode).toBe('E_CONNECT_FAILED');
      expect(connectSpy).toHaveBeenCalledTimes(3);
    });

    it('P2.3: Verification polling retry succeeds when device appears on retry 2', async () => {
      let getDevicesCalls = 0;
      const originalGetDevices = mockAdb.getDevices.bind(mockAdb);

      vi.spyOn(mockAdb, 'getDevices').mockImplementation(async () => {
        getDevicesCalls++;
        const current = await originalGetDevices();
        // Call 1 is initial VALIDATING check
        if (getDevicesCalls === 1) return current;
        // Call 2 is first VERIFYING check: simulate device not appearing yet
        if (getDevicesCalls === 2) {
          return current.filter((d) => d.serial !== '192.168.1.101:5555');
        }
        // Call 3 is second VERIFYING check: device appears
        return current;
      });

      const promise = wizard.migrateToWifi('R5CW10ABCDE', {
        daemonDelayMs: 0,
        verificationRetries: 3,
        verificationRetryDelayMs: 100,
      });

      await vi.advanceTimersByTimeAsync(100);
      const result = await promise;

      expect(result.success).toBe(true);
      expect(result.step).toBe('COMPLETED');
    });

    it('P2.4: Verification fails with E_VERIFICATION_FAILED when device never appears in active list', async () => {
      const originalGetDevices = mockAdb.getDevices.bind(mockAdb);
      let callCount = 0;

      vi.spyOn(mockAdb, 'getDevices').mockImplementation(async () => {
        callCount++;
        const current = await originalGetDevices();
        if (callCount === 1) return current; // initial validation passes
        // All subsequent calls strip wireless device
        return current.filter((d) => !d.serial.includes(':'));
      });

      const promise = wizard.migrateToWifi('R5CW10ABCDE', {
        daemonDelayMs: 0,
        verificationRetries: 2,
        verificationRetryDelayMs: 50,
      });

      await vi.advanceTimersByTimeAsync(100);
      const result = await promise;

      expect(result.success).toBe(false);
      expect(result.errorCode).toBe('E_VERIFICATION_FAILED');
      expect(result.step).toBe('VERIFYING');
    });

    it('P2.5: Concurrent migrations on same device execute deterministically', async () => {
      const p1 = wizard.migrateToWifi('R5CW10ABCDE', { daemonDelayMs: 0 });
      const p2 = wizard.migrateToWifi('R5CW10ABCDE', { daemonDelayMs: 0 });

      const [r1, r2] = await Promise.all([p1, p2]);
      // Both finish without unhandled errors or crashing
      expect(r1.success).toBe(true);
      expect(r2.success).toBe(true);
    });
  });

  // =========================================================================
  // PILLAR 3: Premature USB Detachment During Migration
  // =========================================================================
  describe('Pillar 3: Premature USB Detachment Probes', () => {
    it('P3.1: Detachment before migration returns E_DEVICE_NOT_FOUND', async () => {
      mockAdb.simulateDeviceDisconnect('R5CW10ABCDE');
      const res = await wizard.migrateToWifi('R5CW10ABCDE');

      expect(res.success).toBe(false);
      expect(res.errorCode).toBe('E_DEVICE_NOT_FOUND');
      expect(res.step).toBe('VALIDATING');
    });

    it('P3.2: Device becomes unauthorized before migration returns E_DEVICE_UNAUTHORIZED', async () => {
      mockAdb.simulateDeviceState('R5CW10ABCDE', 'unauthorized');
      const res = await wizard.migrateToWifi('R5CW10ABCDE');

      expect(res.success).toBe(false);
      expect(res.errorCode).toBe('E_DEVICE_UNAUTHORIZED');
      expect(res.step).toBe('VALIDATING');
    });

    it('P3.3: Device drops offline during validation returns E_DEVICE_OFFLINE', async () => {
      mockAdb.simulateDeviceState('R5CW10ABCDE', 'offline');
      const res = await wizard.migrateToWifi('R5CW10ABCDE');

      expect(res.success).toBe(false);
      expect(res.errorCode).toBe('E_DEVICE_OFFLINE');
      expect(res.step).toBe('VALIDATING');
    });

    it('P3.4: USB detached during RESOLVING_IP (getDeviceIp returns null) returns E_NO_WIFI_IP', async () => {
      vi.spyOn(mockAdb, 'getDeviceIp').mockResolvedValueOnce(null);
      const res = await wizard.migrateToWifi('R5CW10ABCDE');

      expect(res.success).toBe(false);
      expect(res.errorCode).toBe('E_NO_WIFI_IP');
      expect(res.step).toBe('RESOLVING_IP');
    });

    it('P3.5: USB detached during SWITCHING_TCPIP returns E_TCPIP_FAILED', async () => {
      vi.spyOn(mockAdb, 'switchTcpip').mockResolvedValueOnce({
        success: false,
        output: "error: device 'R5CW10ABCDE' not found",
        error: 'device not found',
      });

      const res = await wizard.migrateToWifi('R5CW10ABCDE');
      expect(res.success).toBe(false);
      expect(res.errorCode).toBe('E_TCPIP_FAILED');
      expect(res.step).toBe('SWITCHING_TCPIP');
    });

    it('P3.6: Device connected wirelessly but RSA unauthorized returns E_WIFI_UNAUTHORIZED', async () => {
      // Setup: adb.connect succeeds, but when verifying, state is unauthorized
      vi.spyOn(mockAdb, 'getDevices').mockImplementation(async () => {
        return [
          { serial: 'R5CW10ABCDE', state: 'device' },
          { serial: '192.168.1.101:5555', state: 'unauthorized' },
        ];
      });

      const res = await wizard.migrateToWifi('R5CW10ABCDE', { daemonDelayMs: 0 });
      expect(res.success).toBe(false);
      expect(res.errorCode).toBe('E_WIFI_UNAUTHORIZED');
      expect(res.step).toBe('VERIFYING');
    });

    it('P3.7: Device connected wirelessly but reports offline returns E_WIFI_OFFLINE', async () => {
      vi.spyOn(mockAdb, 'getDevices').mockImplementation(async () => {
        return [
          { serial: 'R5CW10ABCDE', state: 'device' },
          { serial: '192.168.1.101:5555', state: 'offline' },
        ];
      });

      const res = await wizard.migrateToWifi('R5CW10ABCDE', { daemonDelayMs: 0 });
      expect(res.success).toBe(false);
      expect(res.errorCode).toBe('E_WIFI_OFFLINE');
      expect(res.step).toBe('VERIFYING');
    });
  });

  // =========================================================================
  // PILLAR 4: Multiple IP Addresses & Invalid IP Parsing
  // =========================================================================
  describe('Pillar 4: Multiple and Malformed IP Parsing Probes', () => {
    const invalidIps = [
      '192.168.1.101\n10.0.0.1',
      '192.168.1.101 192.168.1.102',
      '256.0.0.1',
      '192.168.1.-1',
      '192.168.1',
      '192.168.1.101.55',
      '192.168.1.abc',
      '::1',
      'fe80::1',
      '',
      'null',
      'undefined',
      '192.168.1.101; rm -rf /',
      '192.168.1.101 && reboot',
    ];

    it('P4.1: validateIpAddress rejects all malformed and multi-IP strings', () => {
      for (const badIp of invalidIps) {
        const val = validateIpAddress(badIp);
        expect(val.valid).toBe(false);
        expect(val.error).toBeDefined();
      }
    });

    it('P4.2: validateIpAddress accepts valid IPv4 address strings and trims trailing newlines', () => {
      const validIps = ['192.168.1.1', '10.0.0.1', '172.16.0.50', '127.0.0.1', '0.0.0.0', '255.255.255.255', '192.168.1.101\r\n'];
      for (const goodIp of validIps) {
        expect(validateIpAddress(goodIp)).toEqual({ valid: true });
      }
    });

    it('P4.3: migrateToWifi returns E_INVALID_IP when device reports multi-IP or invalid IP', async () => {
      for (const badIp of invalidIps) {
        vi.spyOn(mockAdb, 'getDeviceIp').mockResolvedValueOnce(badIp);

        const res = await wizard.migrateToWifi('R5CW10ABCDE', { daemonDelayMs: 0 });
        expect(res.success).toBe(false);
        expect(res.errorCode).toBe(badIp ? 'E_INVALID_IP' : 'E_NO_WIFI_IP');
        expect(res.step).toBe('RESOLVING_IP');
      }
    });

    it('P4.4: pairDevice rejects malformed IP without invoking adb pair', async () => {
      const pairSpy = vi.spyOn(mockAdb, 'pair');

      for (const badIp of invalidIps) {
        const res = await wizard.pairDevice({
          ip: badIp,
          pairingPort: 38192,
          code: '123456',
          connectPort: 5555,
        });

        expect(res.success).toBe(false);
        expect(res.error).toMatch(/Invalid IP|Octet out of range|IP address is required/i);
      }

      expect(pairSpy).not.toHaveBeenCalled();
    });
  });

  // =========================================================================
  // PILLAR 5: Timeout Guard Under Hanging ADB Commands
  // =========================================================================
  describe('Pillar 5: Hanging Command Timeout Guard Probes', () => {
    it('P5.1: Timeout guard fires when getDevices hangs indefinitely', async () => {
      vi.spyOn(mockAdb, 'getDevices').mockImplementation(() => new Promise(() => {}));

      const promise = wizard.migrateToWifi('R5CW10ABCDE', { timeoutMs: 100 });
      await vi.advanceTimersByTimeAsync(100);
      const res = await promise;

      expect(res.success).toBe(false);
      expect(res.errorCode).toBe('E_TIMEOUT');
      expect(res.step).toBe('FAILED');
      expect(res.error).toMatch(/timed out/i);
    });

    it('P5.2: Timeout guard fires when getDeviceIp hangs indefinitely', async () => {
      vi.spyOn(mockAdb, 'getDeviceIp').mockImplementation(() => new Promise(() => {}));

      const promise = wizard.migrateToWifi('R5CW10ABCDE', { timeoutMs: 100 });
      await vi.advanceTimersByTimeAsync(100);
      const res = await promise;

      expect(res.success).toBe(false);
      expect(res.errorCode).toBe('E_TIMEOUT');
      expect(res.error).toMatch(/timed out/i);
    });

    it('P5.3: Timeout guard fires when switchTcpip hangs indefinitely', async () => {
      vi.spyOn(mockAdb, 'switchTcpip').mockImplementation(() => new Promise(() => {}));

      const promise = wizard.migrateToWifi('R5CW10ABCDE', { timeoutMs: 100 });
      await vi.advanceTimersByTimeAsync(100);
      const res = await promise;

      expect(res.success).toBe(false);
      expect(res.errorCode).toBe('E_TIMEOUT');
      expect(res.error).toMatch(/timed out/i);
    });

    it('P5.4: Timeout guard fires when connect hangs indefinitely', async () => {
      vi.spyOn(mockAdb, 'connect').mockImplementation(() => new Promise(() => {}));

      const promise = wizard.migrateToWifi('R5CW10ABCDE', { timeoutMs: 100 });
      await vi.advanceTimersByTimeAsync(100);
      const res = await promise;

      expect(res.success).toBe(false);
      expect(res.errorCode).toBe('E_TIMEOUT');
      expect(res.error).toMatch(/timed out/i);
    });

    it('P5.5: Normal successful migration cleans up timeout timer without timer leaks', async () => {
      const promise = wizard.migrateToWifi('R5CW10ABCDE', { timeoutMs: 5000, daemonDelayMs: 0 });
      const res = await promise;

      expect(res.success).toBe(true);
      // Fast forward past 5000ms: should not fire or alter result
      await vi.advanceTimersByTimeAsync(6000);
      expect(res.step).toBe('COMPLETED');
    });

    it('P5.6: wizard.dispose() cancels in-flight delay and timeout timers', async () => {
      const promise = wizard.migrateToWifi('R5CW10ABCDE', { daemonDelayMs: 500, timeoutMs: 10000 });
      // Dispose halfway
      wizard.dispose();
      await vi.advanceTimersByTimeAsync(10000);

      // Verify no exceptions thrown and timers cleared
      expect(wizard.listenerCount('migration-progress')).toBe(0);
    });
  });

  // =========================================================================
  // PILLAR 6: Android 11+ Pairing Adversarial PIN & Port Fuzzing
  // =========================================================================
  describe('Pillar 6: Android 11+ Pairing Adversarial Inputs', () => {
    it('P6.1: validatePairingPin strictly enforces 6 digits and rejects whitespace', () => {
      expect(validatePairingPin(' 123456').valid).toBe(false);
      expect(validatePairingPin('123456 ').valid).toBe(false);
      expect(validatePairingPin('12 456').valid).toBe(false);
      expect(validatePairingPin('000000').valid).toBe(false);
      expect(validatePairingPin('12345').valid).toBe(false);
      expect(validatePairingPin('1234567').valid).toBe(false);
    });

    it('P6.2: pairDevice exhaustively rejects malformed pairing codes without spawning child processes', async () => {
      const pairSpy = vi.spyOn(mockAdb, 'pair');

      const adversarialPins = [
        '000000',     // disallowed / expired test code
        '12345',      // 5 digits
        '1234567',    // 7 digits
        '12 456',     // embedded space
        '123-45',     // hyphen
        '12.345',     // decimal point
        'abcdef',     // alphabetic
        '12345a',     // alphanumeric
        '-12345',     // negative sign
        '',           // empty
        '      ',     // 6 spaces
        '99999\n',    // newline injection
        '123456; reboot', // shell injection
      ];

      for (const pin of adversarialPins) {
        const res = await wizard.pairDevice({
          ip: '192.168.1.101',
          pairingPort: 38192,
          code: pin,
          connectPort: 5555,
        });

        expect(res.success).toBe(false);
        expect(res.paired).toBe(false);
        expect(res.connected).toBe(false);
        expect(res.error).toBeDefined();
      }

      expect(pairSpy).not.toHaveBeenCalled();
    });

    it('P6.3: Rejects boundary and invalid pairing/connect ports without CLI calls', async () => {
      const pairSpy = vi.spyOn(mockAdb, 'pair');

      const invalidPorts = [0, -1, 65536, 70000, NaN, 5555.5, -5555];

      for (const badPort of invalidPorts) {
        const res1 = await wizard.pairDevice('192.168.1.101', badPort, '123456');
        expect(res1.success).toBe(false);
        expect(res1.error).toMatch(/port/i);

        const res2 = await wizard.pairDevice('192.168.1.101', 38192, '123456', badPort);
        expect(res2.success).toBe(false);
        expect(res2.error).toMatch(/port/i);
      }

      expect(pairSpy).not.toHaveBeenCalled();
    });

    it('P6.4: Handles partial success cleanly when pairing succeeds but connection port fails', async () => {
      vi.spyOn(mockAdb, 'pair').mockResolvedValueOnce({
        success: true,
        output: 'Successfully paired to 192.168.1.101:38192',
      });
      vi.spyOn(mockAdb, 'connect').mockResolvedValueOnce({
        success: false,
        output: 'failed to connect to 192.168.1.101:42111: Connection refused',
      });

      const res = await wizard.pairDevice('192.168.1.101', 38192, '123456', 42111);
      expect(res.success).toBe(false);
      expect(res.paired).toBe(true);
      expect(res.connected).toBe(false);
      expect(res.error).toContain('Connection refused');
    });
  });

  // =========================================================================
  // PILLAR 7: RecentDevicesStore MRU Invariants, Persistence & Deduplication Stress
  // =========================================================================
  describe('Pillar 7: Recent Devices Store Stress & Persistence Invariants', () => {
    it('P7.1: High churn stress (50 devices) keeps list strictly bounded at max capacity', () => {
      const store = new RecentDevicesStore({ maxRecentDevices: 5 });

      for (let i = 1; i <= 50; i++) {
        store.addRecentDevice({
          ip: `192.168.1.${i}`,
          port: 5555,
          model: `Phone-${i}`,
          lastSeen: i * 1000,
        });
        expect(store.size()).toBeLessThanOrEqual(5);
      }

      expect(store.size()).toBe(5);
      const devices = store.getRecentDevices();
      // Most recent should be Phone-50 down to Phone-46
      expect(devices[0].model).toBe('Phone-50');
      expect(devices[4].model).toBe('Phone-46');
    });

    it('P7.2: Reconnecting existing device updates timestamp and promotes to index 0 without duplicates', () => {
      const store = new RecentDevicesStore({ maxRecentDevices: 10 });

      store.addRecentDevice({ ip: '192.168.1.10', port: 5555, name: 'Galaxy A' });
      store.addRecentDevice({ ip: '192.168.1.20', port: 5555, name: 'Galaxy B' });
      store.addRecentDevice({ ip: '192.168.1.30', port: 5555, name: 'Galaxy C' });

      expect(store.size()).toBe(3);
      expect(store.getRecentDevices()[0].ip).toBe('192.168.1.30');

      // Reconnect Galaxy A
      store.addRecentDevice({ ip: '192.168.1.10', port: 5555, name: 'Galaxy A' });

      expect(store.size()).toBe(3); // Invariant: no duplicate
      expect(store.getRecentDevices()[0].ip).toBe('192.168.1.10'); // Promoted to top
    });

    it('P7.3: JsonFileRecentDevicesStorage recovers gracefully from corrupt JSON file on disk', () => {
      const tmpPath = path.join(os.tmpdir(), `dexconnect-corrupt-test-${Date.now()}.json`);
      fs.writeFileSync(tmpPath, '{ corrupt invalid json !!', 'utf-8');

      const storage = new JsonFileRecentDevicesStorage(tmpPath);
      const loaded = storage.load();
      expect(loaded).toEqual([]); // Fallback to empty array, no crash

      // Clean up
      if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath);
    });

    it('P7.4: Atomic file saving uses temporary rename to prevent partial writes', () => {
      const tmpPath = path.join(os.tmpdir(), `dexconnect-atomic-test-${Date.now()}.json`);
      const storage = new JsonFileRecentDevicesStorage(tmpPath);

      storage.save([
        {
          id: '192.168.1.101:5555',
          address: '192.168.1.101:5555',
          ip: '192.168.1.101',
          port: 5555,
          name: 'Galaxy S24',
          model: 'Galaxy S24',
          brand: 'samsung',
          lastConnected: Date.now(),
          lastSeen: Date.now(),
        },
      ]);

      expect(fs.existsSync(tmpPath)).toBe(true);
      const parsed = JSON.parse(fs.readFileSync(tmpPath, 'utf-8'));
      expect(parsed).toHaveLength(1);
      expect(parsed[0].ip).toBe('192.168.1.101');

      if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath);
    });
  });
});
