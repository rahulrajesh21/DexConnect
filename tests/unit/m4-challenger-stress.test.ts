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
} from '../../electron/main/services/WirelessWizard';
import {
  RecentDevicesStore,
  InMemoryRecentDevicesStorage,
  JsonFileRecentDevicesStorage,
} from '../../electron/main/services/RecentDevicesStore';
import { MockAdbExecutor } from '../../electron/main/adapters/MockAdbExecutor';
import { DEFAULT_MOCK_DEVICES } from '../fixtures/mockDevices';
import type { PairWirelessPayload } from '../../src/types';

describe('Milestone M4 Empirical Challenge & Adversarial Stress Suite', () => {
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
  // PILLAR 1: Pairing Code Fuzzing & Immediate Rejection Guarantee
  // =========================================================================
  describe('Pillar 1: Pairing Code Fuzzing & Immediate Client-Side Rejection', () => {
    const invalidStringPins: Array<{ pin: string; desc: string }> = [
      { pin: '12345', desc: '5 digits (too short)' },
      { pin: '1234567', desc: '7 digits (too long)' },
      { pin: 'abcdef', desc: '6 alphabetic letters' },
      { pin: '12345a', desc: 'alphanumeric with trailing letter' },
      { pin: 'a12345', desc: 'alphanumeric with leading letter' },
      { pin: '12 345', desc: 'embedded whitespace space' },
      { pin: '12\t456', desc: 'embedded whitespace tab' },
      { pin: '12\n456', desc: 'embedded whitespace newline' },
      { pin: '', desc: 'empty string' },
      { pin: '      ', desc: '6 whitespace spaces' },
      { pin: '\t\t\t\t\t\t', desc: '6 whitespace tabs' },
      { pin: '123-45', desc: 'hyphenated 6 characters' },
      { pin: '123.45', desc: 'decimal dot in 6 characters' },
      { pin: '!@#$%^', desc: 'special characters' },
      { pin: '000000', desc: 'blacklisted test PIN code' },
    ];

    it.each(invalidStringPins)(
      'P1.1 String PIN Fuzzing: validatePairingPin strictly rejects $desc',
      ({ pin }) => {
        const res = validatePairingPin(pin);
        expect(res.valid).toBe(false);
        expect(res.error).toBeDefined();
        expect(res.error!.length).toBeGreaterThan(0);
      }
    );

    it('P1.2 Non-String Type Fuzzing: validatePairingPin rejects non-string types cleanly', () => {
      const nonStringInputs = [
        null as any,
        undefined as any,
        123456 as any,
        {} as any,
        [] as any,
        true as any,
      ];
      for (const input of nonStringInputs) {
        const res = validatePairingPin(input);
        expect(res.valid).toBe(false);
        expect(res.error).toMatch(/must be a string/i);
      }
    });

    it('P1.3 Immediate Rejection Invariant: wizard.pairDevice rejects invalid PINs without ANY adb.pair call', async () => {
      const pairSpy = vi.spyOn(mockAdb, 'pair');

      for (const { pin, desc } of invalidStringPins) {
        const result = await wizard.pairDevice('192.168.1.101', 38192, pin);
        expect(result.success, `Expected failure for ${desc}`).toBe(false);
        expect(result.paired, `Expected paired=false for ${desc}`).toBe(false);
        expect(result.connected, `Expected connected=false for ${desc}`).toBe(false);
        expect(result.error).toMatch(/code|pin|digit|numeric/i);
      }

      // Also verify empty/whitespace via object payload
      const objResult = await wizard.pairDevice({
        ip: '192.168.1.101',
        pairingPort: 38192,
        code: '   ',
      } as any);
      expect(objResult.success).toBe(false);

      // STRICT INVARIANT: adb.pair() must have been called exactly 0 times across all probes
      expect(pairSpy).toHaveBeenCalledTimes(0);
    });

    it('P1.4 Non-String PIN Behavior in pairDevice: Discovers TypeError when non-string passed', async () => {
      // Adversarial probe: when an uncoerced numeric PIN is passed to pairDevice
      // Verifies that unhandled TypeError occurs due to premature .trim() on codeArg
      await expect(
        wizard.pairDevice('192.168.1.101', 38192, 123456 as any)
      ).rejects.toThrow(TypeError);
    });

    it('P1.5 Boundary Valid PINs: Accepts boundary valid 6-digit PINs and invokes adb.pair', async () => {
      const pairSpy = vi.spyOn(mockAdb, 'pair');
      const validPins = ['000001', '012345', '999999', '123456', '543210'];

      for (const pin of validPins) {
        const validation = validatePairingPin(pin);
        expect(validation.valid).toBe(true);

        const res = await wizard.pairDevice('192.168.1.101', 38192, pin);
        expect(res.success).toBe(true);
        expect(res.paired).toBe(true);
        expect(res.connected).toBe(true);
      }

      expect(pairSpy).toHaveBeenCalledTimes(validPins.length);
    });
  });

  // =========================================================================
  // PILLAR 2: Ephemeral Port Separation & Port Fuzzing
  // =========================================================================
  describe('Pillar 2: Ephemeral Port Separation & Port Range Fuzzing', () => {
    it('P2.1 Port Separation: Uses ephemeral pairingPort for adb.pair and connectPort for adb.connect', async () => {
      const pairSpy = vi.spyOn(mockAdb, 'pair');
      const connectSpy = vi.spyOn(mockAdb, 'connect');

      const ip = '192.168.1.101';
      const pairingPort = 38192; // Ephemeral pairing port on dialog
      const connectPort = 42111; // Connection port on main screen

      const result = await wizard.pairDevice(ip, pairingPort, '123456', connectPort);

      expect(result.success).toBe(true);
      expect(result.paired).toBe(true);
      expect(result.connected).toBe(true);
      expect(result.connectPort).toBe(connectPort);

      // Verify adb.pair was invoked with pairingPort
      expect(pairSpy).toHaveBeenCalledWith(`${ip}:${pairingPort}`, '123456');

      // Verify adb.connect was invoked with connectPort
      expect(connectSpy).toHaveBeenCalledWith(`${ip}:${connectPort}`);

      // Verify recent devices store recorded the connection port, NOT the pairing port
      const recents = wizard.getRecentDevices();
      expect(recents.some((r) => r.ip === ip && r.port === connectPort)).toBe(true);
      expect(recents.some((r) => r.ip === ip && r.port === pairingPort)).toBe(false);
    });

    it('P2.2 Default Connect Port: Omitted connection port defaults strictly to 5555', async () => {
      const connectSpy = vi.spyOn(mockAdb, 'connect');

      const ip = '192.168.1.101';
      const pairingPort = 38192;

      // 1. Via positional parameters omitting connectPort
      const resultPositional = await wizard.pairDevice(ip, pairingPort, '123456');
      expect(resultPositional.success).toBe(true);
      expect(resultPositional.connectPort).toBe(5555);
      expect(connectSpy).toHaveBeenCalledWith(`${ip}:5555`);

      // 2. Via object payload omitting connectPort
      connectSpy.mockClear();
      const payload = {
        ip,
        pairingPort: 39000,
        code: '123456',
      } as any;
      const resultPayload = await wizard.pairDevice(payload);
      expect(resultPayload.success).toBe(true);
      expect(resultPayload.connectPort).toBe(5555);
      expect(connectSpy).toHaveBeenCalledWith(`${ip}:5555`);
    });

    const invalidPorts: Array<{ port: any; desc: string }> = [
      { port: 0, desc: 'port 0 (boundary below 1)' },
      { port: 65536, desc: 'port 65536 (boundary above 65535)' },
      { port: 70000, desc: 'port 70000 (well out of bounds)' },
      { port: -1, desc: 'port -1 (negative)' },
      { port: -5555, desc: 'port -5555 (negative port)' },
      { port: NaN, desc: 'NaN' },
      { port: Infinity, desc: 'Infinity' },
      { port: -Infinity, desc: '-Infinity' },
      { port: 5555.5, desc: 'floating point port 5555.5' },
      { port: '5555' as any, desc: 'string "5555" as port' },
      { port: 'invalid_port' as any, desc: 'alphabetic string port' },
    ];

    it.each(invalidPorts)(
      'P2.3 Port Validation: validatePort strictly rejects $desc',
      ({ port }) => {
        const res = validatePort(port);
        expect(res.valid).toBe(false);
        expect(res.error).toBeDefined();
      }
    );

    it('P2.4 Port Rejection Invariant: Invalid pairingPort or connectPort rejects before CLI calls', async () => {
      const pairSpy = vi.spyOn(mockAdb, 'pair');
      const connectSpy = vi.spyOn(mockAdb, 'connect');

      for (const { port, desc } of invalidPorts) {
        // Test invalid pairing port
        const resPair = await wizard.pairDevice('192.168.1.101', port, '123456', 5555);
        expect(resPair.success, `Expected failure for pairingPort ${desc}`).toBe(false);
        expect(resPair.error).toMatch(/port/i);

        // Test invalid connect port
        const resConnect = await wizard.pairDevice('192.168.1.101', 38192, '123456', port);
        expect(resConnect.success, `Expected failure for connectPort ${desc}`).toBe(false);
        expect(resConnect.error).toMatch(/port/i);
      }

      // Zero CLI executions
      expect(pairSpy).toHaveBeenCalledTimes(0);
      expect(connectSpy).toHaveBeenCalledTimes(0);
    });

    it('P2.5 Nullish Coalescing Behavior on connectPort: null coalesces to default 5555', async () => {
      // Connect port as null evaluates via nullish coalescing (null ?? 5555 = 5555)
      const res = await wizard.pairDevice('192.168.1.101', 38192, '123456', null as any);
      expect(res.success).toBe(true);
      expect(res.connectPort).toBe(5555);
    });

    it('P2.6 Partial Failure Handling: Surfaces paired=true, connected=false on connectPort refusal', async () => {
      // Mock adb pair succeeding, but connect failing on custom connectPort
      vi.spyOn(mockAdb, 'pair').mockResolvedValueOnce({
        success: true,
        output: 'Successfully paired to 192.168.1.101:38192 [guid: 12345]',
      });
      vi.spyOn(mockAdb, 'connect').mockResolvedValueOnce({
        success: false,
        output: 'failed to connect to 192.168.1.101:42999: Connection refused',
      });

      const events: any[] = [];
      wizard.on('pairing-state-changed', (e) => events.push(e));

      const result = await wizard.pairDevice('192.168.1.101', 38192, '123456', 42999);

      expect(result.success).toBe(false);
      expect(result.paired).toBe(true);
      expect(result.connected).toBe(false);
      expect(result.error).toMatch(/Connection refused/i);

      // Verify partial_success event was emitted
      expect(events.some((e) => e.state === 'partial_success')).toBe(true);
    });
  });

  // =========================================================================
  // PILLAR 3: Recent Devices Store Under Load & High-Volume Stress
  // =========================================================================
  describe('Pillar 3: Recent Devices Store Under Load (1,000 Devices)', () => {
    it('P3.1 Store Load: Inserts 1,000 distinct devices; strictly enforces capacity limit of 20 and MRU order', () => {
      const store = new RecentDevicesStore({ maxRecentDevices: 20 });
      const TOTAL_DEVICES = 1000;

      const startTime = Date.now();
      for (let i = 0; i < TOTAL_DEVICES; i++) {
        // Construct distinct synthetic IP/port combinations
        const octet3 = Math.floor(i / 250);
        const octet4 = (i % 250) + 1;
        const ip = `10.0.${octet3}.${octet4}`;
        const port = 5000 + (i % 1000);

        store.addRecentDevice({
          ip,
          port,
          name: `Device_${i}`,
          brand: i % 2 === 0 ? 'samsung' : 'motorola',
          lastConnected: startTime + i,
        });
      }

      // CAPACITY BOUND: Exactly 20 devices retained
      expect(store.size()).toBe(20);
      const recents = store.getRecentDevices();
      expect(recents).toHaveLength(20);

      // MRU ORDER: Index 0 is the newest device (Device_999), Index 19 is Device_980
      expect(recents[0].name).toBe('Device_999');
      expect(recents[1].name).toBe('Device_998');
      expect(recents[19].name).toBe('Device_980');

      // Eviction check: Oldest devices (Device_0 through Device_979) must NOT be present
      expect(recents.some((d) => d.name === 'Device_0')).toBe(false);
      expect(recents.some((d) => d.name === 'Device_500')).toBe(false);
      expect(recents.some((d) => d.name === 'Device_979')).toBe(false);
    });

    it('P3.2 Store Deduplication Under Load: 1,000 rapid insertions across 5 devices maintains size 5 and promotes MRU', () => {
      const store = new RecentDevicesStore({ maxRecentDevices: 20 });
      const targetIps = ['192.168.1.10', '192.168.1.20', '192.168.1.30', '192.168.1.40', '192.168.1.50'];

      const TOTAL_INSERTIONS = 1000;
      for (let i = 0; i < TOTAL_INSERTIONS; i++) {
        const targetIp = targetIps[i % targetIps.length];
        store.addRecentDevice({
          ip: targetIp,
          port: 5555,
          name: `Phone_${targetIp}`,
          lastConnected: i,
        });
      }

      // SIZE BOUND: Strictly 5 entries (no duplicates created)
      expect(store.size()).toBe(5);

      // Last touched device was i=999 -> targetIps[999 % 5] = targetIps[4] = '192.168.1.50'
      const recents = store.getRecentDevices();
      expect(recents[0].ip).toBe('192.168.1.50');

      // Touch targetIps[1] ('192.168.1.20') again
      store.addRecentDevice({
        ip: '192.168.1.20',
        port: 5555,
        name: 'Phone_192.168.1.20_Promoted',
        lastConnected: 2000,
      });

      // Still size 5
      expect(store.size()).toBe(5);
      // Promoted to index 0 with updated name
      const updated = store.getRecentDevices();
      expect(updated[0].ip).toBe('192.168.1.20');
      expect(updated[0].name).toBe('Phone_192.168.1.20_Promoted');
    });

    it('P3.3 Deduplication by IP and Model Name: Merges reconnects on changing ephemeral ports', () => {
      const store = new RecentDevicesStore({ maxRecentDevices: 20 });

      // Device connects first time on port 38192
      store.addRecentDevice({
        ip: '192.168.1.75',
        port: 38192,
        name: 'Galaxy Tab S9',
        brand: 'samsung',
        lastConnected: 100,
      });

      expect(store.size()).toBe(1);
      expect(store.getRecentDevices()[0].port).toBe(38192);

      // Reconnects on different port 42111 with same IP and model name
      store.addRecentDevice({
        ip: '192.168.1.75',
        port: 42111,
        name: 'Galaxy Tab S9',
        brand: 'samsung',
        lastConnected: 200,
      });

      // Must be deduplicated into 1 item with updated port
      expect(store.size()).toBe(1);
      const recents = store.getRecentDevices();
      expect(recents[0].ip).toBe('192.168.1.75');
      expect(recents[0].port).toBe(42111);
      expect(recents[0].lastConnected).toBe(200);
    });

    it('P3.4 Atomic Disk Persistence & Corruption Resilience', () => {
      const tmpDir = path.join(os.tmpdir(), `dexconnect-stress-${Date.now()}`);
      fs.mkdirSync(tmpDir, { recursive: true });
      const storeFile = path.join(tmpDir, 'recents.json');

      try {
        // 1. Corrupted File (truncated JSON)
        fs.writeFileSync(storeFile, '{"incomplete": "json', 'utf-8');
        const storage1 = new JsonFileRecentDevicesStorage(storeFile);
        expect(storage1.load()).toEqual([]);

        // Store initializes cleanly from corrupted file without throwing
        const store1 = new RecentDevicesStore({ storage: storage1 });
        expect(store1.size()).toBe(0);

        // 2. Corrupted File (empty string)
        fs.writeFileSync(storeFile, '', 'utf-8');
        expect(storage1.load()).toEqual([]);

        // 3. Corrupted File (non-array JSON object)
        fs.writeFileSync(storeFile, '{"not": "an array"}', 'utf-8');
        expect(storage1.load()).toEqual([]);

        // 4. Corrupted File (binary junk)
        fs.writeFileSync(storeFile, Buffer.from([0x00, 0xff, 0xfe, 0x12, 0x99]));
        expect(storage1.load()).toEqual([]);

        // 5. Atomic write under 1,000 saves
        for (let i = 0; i < 100; i++) {
          store1.addRecentDevice({
            ip: `192.168.1.${i % 30}`,
            port: 5555,
            name: `Stress Device ${i}`,
            lastConnected: i,
          });
        }

        // Verify valid JSON exists on disk
        expect(fs.existsSync(storeFile)).toBe(true);
        const parsed = JSON.parse(fs.readFileSync(storeFile, 'utf-8'));
        expect(Array.isArray(parsed)).toBe(true);
        expect(parsed.length).toBeLessThanOrEqual(20);

        // 6. No lingering temporary files in directory
        const files = fs.readdirSync(tmpDir);
        const tmpFiles = files.filter((f) => f.includes('.tmp.'));
        expect(tmpFiles).toHaveLength(0);
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    });
  });

  // =========================================================================
  // PILLAR 4: Concurrency & Race Condition Resistance
  // =========================================================================
  describe('Pillar 4: Concurrency & Race Condition Resistance', () => {
    it('P4.1 Concurrent Additions: 100 parallel additions to store maintain invariants and zero errors', async () => {
      const store = new RecentDevicesStore({ maxRecentDevices: 20 });

      // Run 100 additions in parallel
      const promises = Array.from({ length: 100 }, (_, i) => {
        return Promise.resolve().then(() => {
          return store.addRecentDevice({
            ip: `192.168.2.${i}`,
            port: 5555,
            name: `Async Phone ${i}`,
            lastConnected: i,
          });
        });
      });

      await Promise.all(promises);

      expect(store.size()).toBe(20);
      const devices = store.getRecentDevices();
      expect(devices).toHaveLength(20);
      // All items have valid structures
      for (const d of devices) {
        expect(d.ip).toMatch(/^192\.168\.2\.\d+$/);
        expect(d.port).toBe(5555);
        expect(d.name).toBeDefined();
      }
    });

    it('P4.2 Concurrent Pair Requests: Handles multiple parallel pairDevice calls safely', async () => {
      const pairSpy = vi.spyOn(mockAdb, 'pair');
      const connectSpy = vi.spyOn(mockAdb, 'connect');

      // Execute 10 simultaneous pairing calls
      const requests = Array.from({ length: 10 }, (_, i) => {
        return wizard.pairDevice({
          ip: `192.168.1.101`,
          pairingPort: 38000 + i,
          code: '123456',
          connectPort: 42000 + i,
        });
      });

      const results = await Promise.all(requests);

      expect(results).toHaveLength(10);
      for (const res of results) {
        expect(res.success).toBe(true);
        expect(res.paired).toBe(true);
        expect(res.connected).toBe(true);
      }

      expect(pairSpy).toHaveBeenCalledTimes(10);
      expect(connectSpy).toHaveBeenCalledTimes(10);
    });

    it('P4.3 Concurrent Connect and Disconnect Operations: Resists race conditions without crashing', async () => {
      const operations: Promise<any>[] = [];

      for (let i = 0; i < 20; i++) {
        if (i % 2 === 0) {
          operations.push(wizard.connectWireless('192.168.1.101', 5555));
        } else {
          operations.push(wizard.disconnectWireless('192.168.1.101:5555'));
        }
      }

      const results = await Promise.all(operations);
      expect(results).toHaveLength(20);
      for (const res of results) {
        expect(typeof res.success).toBe('boolean');
      }
    });
  });
});
