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
import {
  MockAdbExecutor,
  type MockDeviceState,
} from '../../electron/main/adapters/MockAdbExecutor';
import {
  MOCK_SAMSUNG_S24,
  MOCK_MOTOROLA_EDGE,
  MOCK_GENERIC_ANDROID,
} from '../fixtures/mockDevices';
import type { DeviceInfo, BatteryInfo } from '../../src/types';

describe('Milestone M2 Adversarial & Stress Testing Suite', () => {
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

  // =========================================================================
  // CATEGORY 1: Rapid Connect / Disconnect Churn
  // =========================================================================
  describe('Category 1: Rapid Connect / Disconnect Churn', () => {
    it('survives 50 rapid sequential connect/disconnect cycles without cache leak', async () => {
      manager = new DeviceManager(mockAdb);
      const attachedEvents: DeviceInfo[] = [];
      const detachedEvents: DeviceInfo[] = [];

      manager.on('device-attached', (d) => attachedEvents.push(d));
      manager.on('device-detached', (d) => detachedEvents.push(d));

      const iterations = 50;
      for (let i = 0; i < iterations; i++) {
        // Connect
        mockAdb.simulateDeviceConnect(MOCK_SAMSUNG_S24);
        const devsConnected = await manager.refresh();
        expect(devsConnected).toHaveLength(1);
        expect(devsConnected[0].serial).toBe(MOCK_SAMSUNG_S24.raw.serial);
        expect(manager.getCacheSize()).toBe(1);

        // Disconnect
        mockAdb.simulateDeviceDisconnect(MOCK_SAMSUNG_S24.raw.serial);
        const devsDisconnected = await manager.refresh();
        expect(devsDisconnected).toHaveLength(0);
        expect(manager.getCacheSize()).toBe(0);
      }

      expect(attachedEvents).toHaveLength(iterations);
      expect(detachedEvents).toHaveLength(iterations);
      expect(manager.getDevices()).toHaveLength(0);
      expect(manager.getCacheSize()).toBe(0);
    });

    it('handles 60 interleaved connect/disconnect operations across 3 distinct devices', async () => {
      manager = new DeviceManager(mockAdb);
      const attachedSerials: string[] = [];
      const detachedSerials: string[] = [];
      const updatedEvents: DeviceInfo[][] = [];

      manager.on('device-attached', (d) => attachedSerials.push(d.serial));
      manager.on('device-detached', (d) => detachedSerials.push(d.serial));
      manager.on('devices-updated', (devs) => updatedEvents.push(devs));

      const devices = [MOCK_SAMSUNG_S24, MOCK_MOTOROLA_EDGE, MOCK_GENERIC_ANDROID];
      const activeState = new Set<string>();

      // 60 interleaved steps (cycling through connect / disconnect combinations)
      for (let step = 0; step < 60; step++) {
        const targetDev = devices[step % 3];
        const isCurrentlyActive = activeState.has(targetDev.raw.serial);

        if (isCurrentlyActive) {
          mockAdb.simulateDeviceDisconnect(targetDev.raw.serial);
          activeState.delete(targetDev.raw.serial);
        } else {
          mockAdb.simulateDeviceConnect(targetDev);
          activeState.add(targetDev.raw.serial);
        }

        const currentDevs = await manager.refresh();
        const currentSerials = currentDevs.map((d) => d.serial).sort();
        const expectedSerials = Array.from(activeState).sort();

        expect(currentSerials).toEqual(expectedSerials);
        expect(manager.getCacheSize()).toBe(activeState.size);
      }

      // Teardown remaining active devices
      for (const dev of devices) {
        if (activeState.has(dev.raw.serial)) {
          mockAdb.simulateDeviceDisconnect(dev.raw.serial);
        }
      }
      await manager.refresh();
      expect(manager.getDevices()).toHaveLength(0);
      expect(manager.getCacheSize()).toBe(0);
      expect(attachedSerials.length).toBe(detachedSerials.length);
    });

    it('absorbs burst changes occurring between poll ticks without intermediate event spam', async () => {
      manager = new DeviceManager(mockAdb);
      const attached: string[] = [];
      const detached: string[] = [];

      manager.on('device-attached', (d) => attached.push(d.serial));
      manager.on('device-detached', (d) => detached.push(d.serial));

      // Burst: connect S24, then disconnect S24, connect Motorola, connect Generic, disconnect Motorola
      // all before single poll
      mockAdb.simulateDeviceConnect(MOCK_SAMSUNG_S24);
      mockAdb.simulateDeviceDisconnect(MOCK_SAMSUNG_S24.raw.serial);
      mockAdb.simulateDeviceConnect(MOCK_MOTOROLA_EDGE);
      mockAdb.simulateDeviceConnect(MOCK_GENERIC_ANDROID);
      mockAdb.simulateDeviceDisconnect(MOCK_MOTOROLA_EDGE.raw.serial);

      const devs = await manager.refresh();

      // Only Generic should ever be seen
      expect(devs).toHaveLength(1);
      expect(devs[0].serial).toBe(MOCK_GENERIC_ANDROID.raw.serial);
      expect(attached).toEqual([MOCK_GENERIC_ANDROID.raw.serial]);
      expect(detached).toHaveLength(0); // S24 & Motorola were never attached from manager perspective
    });

    it('stress tests rapid churn under active background polling (50ms interval)', async () => {
      manager = new DeviceManager(mockAdb, { pollIntervalMs: 50, autoStart: true });
      const updates: DeviceInfo[][] = [];
      manager.on('devices-updated', (devs) => updates.push(devs));

      // Initial tick
      await vi.advanceTimersByTimeAsync(10);
      expect(updates).toHaveLength(0);

      // Perform 20 timed attach/detach cycles
      for (let i = 0; i < 20; i++) {
        mockAdb.simulateDeviceConnect(MOCK_SAMSUNG_S24);
        await vi.advanceTimersByTimeAsync(50);
        expect(manager.getDevices()).toHaveLength(1);

        mockAdb.simulateDeviceDisconnect(MOCK_SAMSUNG_S24.raw.serial);
        await vi.advanceTimersByTimeAsync(50);
        expect(manager.getDevices()).toHaveLength(0);
      }

      expect(updates.length).toBe(40); // exactly 20 connects + 20 disconnects
      expect(manager.getCacheSize()).toBe(0);
    });
  });

  // =========================================================================
  // CATEGORY 2: Concurrent refresh() & Race Condition Immunity
  // =========================================================================
  describe('Category 2: Concurrent refresh() & Race Condition Immunity', () => {
    it('handles 50 concurrent refresh() calls safely with 1 ADB poll execution', async () => {
      mockAdb.reset([MOCK_SAMSUNG_S24, MOCK_MOTOROLA_EDGE]);
      manager = new DeviceManager(mockAdb);

      const adbSpy = vi.spyOn(mockAdb, 'getDevices');
      const calls = Array.from({ length: 50 }, () => manager.refresh());

      const results = await Promise.all(calls);

      // Deduplication: all 50 calls resolved to the exact same single poll
      expect(adbSpy).toHaveBeenCalledTimes(1);
      expect(results).toHaveLength(50);
      for (const res of results) {
        expect(res).toHaveLength(2);
        expect(res[0].serial).toBe(MOCK_SAMSUNG_S24.raw.serial);
        expect(res[1].serial).toBe(MOCK_MOTOROLA_EDGE.raw.serial);
      }
      expect(manager.getCacheSize()).toBe(2);
    });

    it('handles concurrent refresh() calls while background timer is actively ticking', async () => {
      mockAdb.reset([MOCK_SAMSUNG_S24]);
      manager = new DeviceManager(mockAdb, { pollIntervalMs: 100, autoStart: true });

      const updates: DeviceInfo[][] = [];
      manager.on('devices-updated', (d) => updates.push(d));

      // Fire initial background tick
      await vi.advanceTimersByTimeAsync(10);
      expect(updates).toHaveLength(1);

      // Fire 10 concurrent refreshes interleaved with timer advancing
      const p1 = manager.refresh();
      const p2 = manager.refresh();
      await vi.advanceTimersByTimeAsync(50);
      const p3 = manager.refresh();
      const p4 = manager.refresh();
      await vi.advanceTimersByTimeAsync(60);

      const [r1, r2, r3, r4] = await Promise.all([p1, p2, p3, p4]);
      expect(r1).toHaveLength(1);
      expect(r2).toHaveLength(1);
      expect(r3).toHaveLength(1);
      expect(r4).toHaveLength(1);

      // Duplicate emissions must be suppressed
      expect(updates).toHaveLength(1);
      expect(manager.isStarted()).toBe(true);
    });

    it('survives rapid start() / stop() / refresh() cycles without orphaned timers or memory leaks', async () => {
      mockAdb.reset([MOCK_SAMSUNG_S24]);
      manager = new DeviceManager(mockAdb, { pollIntervalMs: 100 });

      for (let i = 0; i < 20; i++) {
        manager.start();
        expect(manager.isStarted()).toBe(true);
        void manager.refresh();
        manager.stop();
        expect(manager.isStarted()).toBe(false);
      }

      // Advance timers by large amount; no ticks should fire while stopped
      const adbSpy = vi.spyOn(mockAdb, 'getDevices');
      await vi.advanceTimersByTimeAsync(2000);
      expect(adbSpy).not.toHaveBeenCalled();
    });

    it('handles simulated slow ADB query during concurrent refresh requests', async () => {
      mockAdb.reset([MOCK_SAMSUNG_S24]);
      manager = new DeviceManager(mockAdb);

      let resolveSlowQuery: ((value: any) => void) | null = null;
      const slowPromise = new Promise<any>((resolve) => {
        resolveSlowQuery = resolve;
      });

      const originalGetDevices = mockAdb.getDevices.bind(mockAdb);
      vi.spyOn(mockAdb, 'getDevices').mockImplementationOnce(() => slowPromise);

      // Launch first refresh (which hangs waiting on slowPromise)
      const p1 = manager.refresh();

      // Launch 5 more concurrent refreshes while slow query is in-flight
      const p2 = manager.refresh();
      const p3 = manager.refresh();
      const p4 = manager.refresh();

      // Resolve the slow query
      const devices = await originalGetDevices();
      resolveSlowQuery!(devices);

      const [res1, res2, res3, res4] = await Promise.all([p1, p2, p3, p4]);
      expect(res1).toHaveLength(1);
      expect(res2).toHaveLength(1);
      expect(res3).toHaveLength(1);
      expect(res4).toHaveLength(1);
      expect(manager.getCacheSize()).toBe(1);
    });
  });

  // =========================================================================
  // CATEGORY 3: Rapid Device State Transitions (Degraded & Recovery)
  // =========================================================================
  describe('Category 3: Rapid Device State Transitions', () => {
    it('correctly invalidates and re-resolves properties over 10 state cycles (device -> unauthorized -> offline -> device)', async () => {
      mockAdb.reset([MOCK_SAMSUNG_S24]);
      manager = new DeviceManager(mockAdb);

      const updatedEvents: DeviceInfo[][] = [];
      const attachedEvents: DeviceInfo[] = [];
      const detachedEvents: DeviceInfo[] = [];

      manager.on('devices-updated', (d) => updatedEvents.push(d));
      manager.on('device-attached', (d) => attachedEvents.push(d));
      manager.on('device-detached', (d) => detachedEvents.push(d));

      const getPropSpy = vi.spyOn(mockAdb, 'getProp');

      // Initial resolution in 'device' state
      const initial = await manager.refresh();
      expect(initial[0].state).toBe('device');
      expect(initial[0].brand).toBe('samsung');
      expect(initial[0].model).toBe('SM-S928B');
      expect(manager.getCacheSize()).toBe(1);
      expect(attachedEvents).toHaveLength(1);
      expect(getPropSpy).toHaveBeenCalledTimes(3); // manufacturer, model, version

      for (let cycle = 1; cycle <= 10; cycle++) {
        // 1. Transition to unauthorized
        mockAdb.simulateDeviceState(MOCK_SAMSUNG_S24.raw.serial, 'unauthorized');
        const devsUnauth = await manager.refresh();
        expect(devsUnauth[0].state).toBe('unauthorized');
        expect(devsUnauth[0].brand).toBe('generic');
        expect(devsUnauth[0].manufacturer).toBe('unknown');
        expect(devsUnauth[0].androidVersion).toBe('unknown');
        expect(devsUnauth[0].battery.level).toBe(100);
        // Cache must be evicted when state is unauthorized
        expect(manager.getCacheSize()).toBe(0);

        // 2. Transition to offline
        mockAdb.simulateDeviceState(MOCK_SAMSUNG_S24.raw.serial, 'offline');
        const devsOffline = await manager.refresh();
        expect(devsOffline[0].state).toBe('offline');
        expect(manager.getCacheSize()).toBe(0);

        // 3. Re-authorize to 'device'
        mockAdb.simulateDeviceState(MOCK_SAMSUNG_S24.raw.serial, 'device');
        const prevCallCount = getPropSpy.mock.calls.length;
        const devsRecovered = await manager.refresh();
        expect(devsRecovered[0].state).toBe('device');
        expect(devsRecovered[0].brand).toBe('samsung');
        expect(devsRecovered[0].model).toBe('SM-S928B');
        expect(devsRecovered[0].androidVersion).toBe('14');
        expect(devsRecovered[0].battery.level).toBe(85);
        // Cache must be re-populated
        expect(manager.getCacheSize()).toBe(1);
        // Re-resolution of static properties must have been triggered
        expect(getPropSpy.mock.calls.length).toBe(prevCallCount + 3);
      }

      // Attached and detached events are ONLY for serial appearance / disappearance, NOT state changes
      expect(attachedEvents).toHaveLength(1);
      expect(detachedEvents).toHaveLength(0);
      // Each transition (device -> unauth -> offline -> device) emitted a devices-updated event
      expect(updatedEvents.length).toBe(1 + 10 * 3);
    });

    it('immediately reflects updated device properties upon recovery from degraded state', async () => {
      mockAdb.reset([MOCK_SAMSUNG_S24]);
      manager = new DeviceManager(mockAdb);

      await manager.refresh();
      expect(manager.getDevices()[0].model).toBe('SM-S928B');

      // Make offline
      mockAdb.simulateDeviceState(MOCK_SAMSUNG_S24.raw.serial, 'offline');
      await manager.refresh();

      // Update mock properties while offline
      const devState = (mockAdb as any).devices.get(MOCK_SAMSUNG_S24.raw.serial);
      devState.props['ro.product.model'] = 'SM-S928B-UPDATED';
      devState.props['ro.build.version.release'] = '15';

      // Re-authorize
      mockAdb.simulateDeviceState(MOCK_SAMSUNG_S24.raw.serial, 'device');
      const recovered = await manager.refresh();

      expect(recovered[0].model).toBe('SM-S928B-UPDATED');
      expect(recovered[0].androidVersion).toBe('15');
    });

    it('immediately re-queries battery on state recovery bypassing 10s battery throttle', async () => {
      mockAdb.reset([MOCK_SAMSUNG_S24]);
      manager = new DeviceManager(mockAdb, { batteryRefreshIntervalMs: 10000 });

      const battSpy = vi.spyOn(mockAdb, 'getBatteryInfo');
      await manager.refresh();
      expect(battSpy).toHaveBeenCalledTimes(1);

      // Second immediate poll in device state suppresses battery call due to throttle
      await manager.refresh();
      expect(battSpy).toHaveBeenCalledTimes(1);

      // Transition to unauthorized
      mockAdb.simulateDeviceState(MOCK_SAMSUNG_S24.raw.serial, 'unauthorized');
      await manager.refresh();
      expect(battSpy).toHaveBeenCalledTimes(1); // skipped because state !== device

      // Re-authorize to device: cache was evicted, so fresh battery query MUST execute
      mockAdb.simulateDeviceState(MOCK_SAMSUNG_S24.raw.serial, 'device');
      mockAdb.simulateBatteryUpdate(MOCK_SAMSUNG_S24.raw.serial, { level: 42 });
      const rec = await manager.refresh();

      expect(battSpy).toHaveBeenCalledTimes(2);
      expect(rec[0].battery.level).toBe(42);
    });
  });

  // =========================================================================
  // CATEGORY 4: Cache Mutation Resistance
  // =========================================================================
  describe('Category 4: Cache Mutation Resistance', () => {
    it('defends internal state when array returned by getDevices() is aggressively mutated', async () => {
      mockAdb.reset([MOCK_SAMSUNG_S24, MOCK_MOTOROLA_EDGE]);
      manager = new DeviceManager(mockAdb);
      await manager.refresh();

      const arr1 = manager.getDevices();
      expect(arr1).toHaveLength(2);

      // Aggressive array mutations
      arr1.pop();
      arr1.length = 0;
      arr1.push({
        serial: 'MALICIOUS_SERIAL',
        state: 'device',
        brand: 'generic',
        manufacturer: 'hacked',
        model: 'hacked',
        androidVersion: '99',
        connectionType: 'usb',
        battery: { level: 0, scale: 100, status: 0, isCharging: false, powerSource: 'battery' },
      });

      // Internal manager state must remain unchanged
      const arr2 = manager.getDevices();
      expect(arr2).toHaveLength(2);
      expect(arr2[0].serial).toBe(MOCK_SAMSUNG_S24.raw.serial);
      expect(arr2[1].serial).toBe(MOCK_MOTOROLA_EDGE.raw.serial);
    });

    it('defends internal state when device properties and battery object are mutated in-place', async () => {
      mockAdb.reset([MOCK_SAMSUNG_S24]);
      manager = new DeviceManager(mockAdb);
      await manager.refresh();

      const devSnapshot = manager.getDevices()[0];

      // Mutate primitive properties
      (devSnapshot as any).brand = 'motorola';
      (devSnapshot as any).model = 'COMPROMISED_MODEL';
      (devSnapshot as any).state = 'offline';

      // Mutate nested battery object
      devSnapshot.battery.level = -1;
      devSnapshot.battery.isCharging = false;
      devSnapshot.battery.powerSource = 'ac';

      // Subsequent getDevices() must return original pristine properties
      const freshDev = manager.getDevices()[0];
      expect(freshDev.brand).toBe('samsung');
      expect(freshDev.model).toBe('SM-S928B');
      expect(freshDev.state).toBe('device');
      expect(freshDev.battery.level).toBe(85);
      expect(freshDev.battery.isCharging).toBe(true);
      expect(freshDev.battery.powerSource).toBe('usb');

      // getDeviceBySerial() must also remain pristine
      const bySerial = manager.getDeviceBySerial(MOCK_SAMSUNG_S24.raw.serial)!;
      expect(bySerial.brand).toBe('samsung');
      expect(bySerial.battery.level).toBe(85);
    });

    it('defends internal state when event listeners mutate their payload arguments', async () => {
      mockAdb.reset([MOCK_SAMSUNG_S24]);
      manager = new DeviceManager(mockAdb);

      manager.on('device-attached', (dev) => {
        dev.battery.level = 0;
        (dev as any).model = 'MUTATED_IN_LISTENER';
      });

      manager.on('devices-updated', (list) => {
        list[0].battery.level = 1;
        list.pop();
      });

      await manager.refresh();

      const current = manager.getDevices();
      expect(current).toHaveLength(1);
      expect(current[0].model).toBe('SM-S928B');
      expect(current[0].battery.level).toBe(85);
    });
  });

  // =========================================================================
  // CATEGORY 5: Adversarial Edge Cases & Boundary Probing
  // =========================================================================
  describe('Category 5: Adversarial Edge Cases & Boundary Probing', () => {
    it('gracefully handles malformed Wi-Fi serials without crashing', () => {
      // Missing port, non-numeric port, IPv6 brackets, colons in weird spots
      expect(parseSerialAddress('')).toEqual({});
      expect(parseSerialAddress(':::')).toEqual({});
      expect(parseSerialAddress('192.168.1.100')).toEqual({});
      expect(parseSerialAddress('192.168.1.100:invalid_port')).toEqual({});
      expect(parseSerialAddress('192.168.1.100:-5555')).toEqual({});
      expect(parseSerialAddress('[fe80::1]:5555')).toEqual({}); // Multi-colon IPv6 addresses gracefully fall back to empty
      expect(parseSerialAddress('192.168.1.100:5555')).toEqual({
        ip: '192.168.1.100',
        port: 5555,
      });

      expect(detectConnectionType('192.168.1.100:5555')).toBe('wifi');
      expect(detectConnectionType('USBSERIAL123')).toBe('usb');
    });

    it('survives swarm load of 100 simultaneous devices attached and detached', async () => {
      const swarmSize = 100;
      const swarmDevices: MockDeviceState[] = Array.from({ length: swarmSize }, (_, i) => ({
        raw: {
          serial: `SWARM_DEV_${i.toString().padStart(3, '0')}`,
          state: 'device',
          product: `prod_${i}`,
          model: `Model_${i}`,
          device: `device_${i}`,
          transportId: String(i + 1),
        },
        props: {
          'ro.product.manufacturer': i % 2 === 0 ? 'samsung' : 'motorola',
          'ro.product.model': `Model_${i}`,
          'ro.build.version.release': '14',
        },
        battery: {
          level: (i * 7) % 100,
          scale: 100,
          status: 2,
          isCharging: true,
          powerSource: 'usb',
        },
        ipAddress: null,
        tcpipPort: null,
      }));

      mockAdb.reset(swarmDevices);
      manager = new DeviceManager(mockAdb);

      const devs = await manager.refresh();
      expect(devs).toHaveLength(swarmSize);
      expect(manager.getCacheSize()).toBe(swarmSize);

      // Verify brand distribution
      const samsungCount = devs.filter((d) => d.brand === 'samsung').length;
      const motorolaCount = devs.filter((d) => d.brand === 'motorola').length;
      expect(samsungCount).toBe(50);
      expect(motorolaCount).toBe(50);

      // Now detach all 100 devices at once
      mockAdb.reset([]);
      const detachedDevs = await manager.refresh();
      expect(detachedDevs).toHaveLength(0);
      expect(manager.getCacheSize()).toBe(0);
      expect(manager.getDevices()).toHaveLength(0);
    });

    it('cleans up completely on dispose() with no memory leaks or pending timers', async () => {
      mockAdb.reset([MOCK_SAMSUNG_S24]);
      manager = new DeviceManager(mockAdb, { pollIntervalMs: 50, autoStart: true });

      await vi.advanceTimersByTimeAsync(10);
      expect(manager.getCacheSize()).toBe(1);

      manager.dispose();
      expect(manager.isStarted()).toBe(false);
      expect(manager.getCacheSize()).toBe(0);
      expect(manager.getDevices()).toHaveLength(0);
      expect(manager.listenerCount('devices-updated')).toBe(0);

      // Advance timers far into future; zero operations should run
      const adbSpy = vi.spyOn(mockAdb, 'getDevices');
      await vi.advanceTimersByTimeAsync(5000);
      expect(adbSpy).not.toHaveBeenCalled();
    });

    it('verifies behavior when error listener is present vs absent during ADB errors', async () => {
      // Note: Node.js EventEmitter emits 'error', which if unhandled in standard EventEmitter throws.
      // DeviceManager provides 'error' event hook for consumers.
      mockAdb.reset([]);
      manager = new DeviceManager(mockAdb);

      const errors: unknown[] = [];
      manager.on('error', (err) => errors.push(err));

      vi.spyOn(mockAdb, 'getDevices').mockRejectedValueOnce(new Error('ADB daemon connection refused'));
      const devs = await manager.refresh();

      expect(errors).toHaveLength(1);
      expect((errors[0] as Error).message).toBe('ADB daemon connection refused');
      expect(devs).toHaveLength(0);
    });
  });
});
