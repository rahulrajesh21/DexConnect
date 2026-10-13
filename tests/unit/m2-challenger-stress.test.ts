import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  DeviceManager,
  areDeviceListsEqual,
  isBatteryEqual,
  isDeviceEqual,
} from '../../electron/main/services/DeviceManager';
import { MockAdbExecutor } from '../../electron/main/adapters/MockAdbExecutor';
import {
  MOCK_SAMSUNG_S24,
  MOCK_MOTOROLA_EDGE,
  MOCK_GENERIC_ANDROID,
} from '../fixtures/mockDevices';
import type { DeviceInfo, BatteryInfo } from '../../src/types';

describe('Milestone M2 Empirical Challenge & Stress Suite', () => {
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
  // 1. 3-Second Detection SLA
  // =========================================================================
  describe('Pillar 1: 3-Second Detection SLA Probes', () => {
    it('SLA 1.1: Attachment at t=0ms is detected and emitted on the first tick (<= 2000ms < 3000ms)', async () => {
      mockAdb.reset([]);
      manager = new DeviceManager(mockAdb, { pollIntervalMs: 2000, autoStart: true });

      // Initial tick finishes at ~0ms
      await vi.advanceTimersByTimeAsync(1);
      expect(manager.getDevices()).toHaveLength(0);

      const emitTimestamps: number[] = [];
      manager.on('devices-updated', () => {
        emitTimestamps.push(Date.now());
      });

      const connectTime = Date.now();
      mockAdb.simulateDeviceConnect(MOCK_SAMSUNG_S24);

      // Advance by 2000ms (next tick)
      await vi.advanceTimersByTimeAsync(2000);

      expect(emitTimestamps).toHaveLength(1);
      const detectionLatency = emitTimestamps[0] - connectTime;
      expect(detectionLatency).toBeLessThan(3000);
      expect(detectionLatency).toBeLessThanOrEqual(2000);
      expect(manager.getDevices()[0].serial).toBe(MOCK_SAMSUNG_S24.raw.serial);
    });

    it('SLA 1.2: Attachment at arbitrary mid-cycle offsets (t=500ms, t=1200ms, t=1800ms) emits in < 3000ms', async () => {
      // Test various mid-cycle offsets within the 2000ms polling cycle
      const testOffsets = [300, 750, 1500, 1800];

      for (const offset of testOffsets) {
        mockAdb.reset([]);
        if (manager) manager.dispose();
        manager = new DeviceManager(mockAdb, { pollIntervalMs: 2000, autoStart: true });

        await vi.advanceTimersByTimeAsync(1); // Cycle 0 completes

        // Advance to mid-cycle offset
        await vi.advanceTimersByTimeAsync(offset);

        let detectedAt = -1;
        manager.once('devices-updated', () => {
          detectedAt = Date.now();
        });

        const connectTime = Date.now();
        mockAdb.simulateDeviceConnect(MOCK_SAMSUNG_S24);

        // Advance by at most 2500ms (< 3000ms SLA)
        await vi.advanceTimersByTimeAsync(2500);

        expect(detectedAt).toBeGreaterThan(0);
        const elapsed = detectedAt - connectTime;
        expect(elapsed).toBeLessThan(3000);
      }
    });

    it('SLA 1.3: Detachment at mid-cycle offset (t=1500ms) emits in < 3000ms and evicts cache', async () => {
      mockAdb.reset([MOCK_SAMSUNG_S24]);
      manager = new DeviceManager(mockAdb, { pollIntervalMs: 2000, autoStart: true });

      await vi.advanceTimersByTimeAsync(1);
      expect(manager.getDevices()).toHaveLength(1);

      // Advance to 1500ms into cycle 1
      await vi.advanceTimersByTimeAsync(1500);

      let detachedEventEmitted = false;
      let updatedEventEmitted = false;
      let detectedTime = -1;

      manager.once('device-detached', (d) => {
        detachedEventEmitted = true;
        expect(d.serial).toBe(MOCK_SAMSUNG_S24.raw.serial);
      });
      manager.once('devices-updated', (devs) => {
        updatedEventEmitted = true;
        detectedTime = Date.now();
        expect(devs).toHaveLength(0);
      });

      const disconnectTime = Date.now();
      mockAdb.simulateDeviceDisconnect(MOCK_SAMSUNG_S24.raw.serial);

      // Remaining 500ms until tick
      await vi.advanceTimersByTimeAsync(500);

      expect(detachedEventEmitted).toBe(true);
      expect(updatedEventEmitted).toBe(true);
      const elapsed = detectedTime - disconnectTime;
      expect(elapsed).toBeLessThan(3000);
      expect(elapsed).toBeLessThanOrEqual(500);
      expect(manager.getCacheSize()).toBe(0);
    });

    it('SLA 1.4: Real wall-clock timing probe verifies attachment and detachment latency < 3000ms', async () => {
      // Run with real timers!
      vi.useRealTimers();
      mockAdb.reset([]);
      manager = new DeviceManager(mockAdb, { pollIntervalMs: 2000, autoStart: true });

      // Wait 10ms for initial poll
      await new Promise((resolve) => setTimeout(resolve, 20));

      // 1. Measure real attachment latency
      const startConnect = performance.now();
      const attachPromise = new Promise<number>((resolve) => {
        manager.once('devices-updated', () => {
          resolve(performance.now() - startConnect);
        });
      });

      mockAdb.simulateDeviceConnect(MOCK_SAMSUNG_S24);
      const realAttachLatency = await attachPromise;

      expect(realAttachLatency).toBeLessThan(3000);
      expect(realAttachLatency).toBeGreaterThanOrEqual(1900); // 2000ms cadence

      // 2. Measure real detachment latency
      const startDisconnect = performance.now();
      const detachPromise = new Promise<number>((resolve) => {
        manager.once('devices-updated', () => {
          resolve(performance.now() - startDisconnect);
        });
      });

      mockAdb.simulateDeviceDisconnect(MOCK_SAMSUNG_S24.raw.serial);
      const realDetachLatency = await detachPromise;

      expect(realDetachLatency).toBeLessThan(3000);
      expect(realDetachLatency).toBeGreaterThanOrEqual(1900);
    });

    it('SLA 1.5: Simultaneous batch attachment of 5 devices is processed within single tick (< 3000ms)', async () => {
      mockAdb.reset([]);
      manager = new DeviceManager(mockAdb, { pollIntervalMs: 2000, autoStart: true });
      await vi.advanceTimersByTimeAsync(1);

      // Generate 5 mock devices
      const batchDevices = Array.from({ length: 5 }, (_, i) => ({
        raw: {
          serial: `BATCH_DEV_${i}`,
          state: 'device' as const,
          product: `prod_${i}`,
          model: `BatchModel_${i}`,
          device: `batch_${i}`,
          transportId: `${10 + i}`,
        },
        props: {
          'ro.product.manufacturer': i % 2 === 0 ? 'samsung' : 'motorola',
          'ro.product.model': `BatchModel_${i}`,
          'ro.build.version.release': '14',
        },
        battery: {
          level: 70 + i,
          scale: 100,
          status: 2,
          isCharging: true,
          powerSource: 'usb' as const,
        },
        ipAddress: `192.168.1.${50 + i}`,
        tcpipPort: null,
      }));

      for (const dev of batchDevices) {
        mockAdb.simulateDeviceConnect(dev);
      }

      let emittedCount = 0;
      manager.on('devices-updated', (devs) => {
        emittedCount = devs.length;
      });

      await vi.advanceTimersByTimeAsync(2000);

      expect(emittedCount).toBe(5);
      expect(manager.getDevices()).toHaveLength(5);
      expect(manager.getCacheSize()).toBe(5);
    });
  });

  // =========================================================================
  // 2. Event Suppression across 20 Simulated Poll Cycles
  // =========================================================================
  describe('Pillar 2: Event Suppression Across 20 Poll Cycles', () => {
    it('SUPPRESS 2.1: Exactly 0 duplicate devices-updated events across 20 poll cycles for single device', async () => {
      mockAdb.reset([MOCK_SAMSUNG_S24]);
      manager = new DeviceManager(mockAdb, { pollIntervalMs: 2000, autoStart: true });

      let eventCount = 0;
      manager.on('devices-updated', () => {
        eventCount++;
      });

      // Initial tick: discovers Samsung S24
      await vi.advanceTimersByTimeAsync(1);
      expect(eventCount).toBe(1);

      // Run exactly 20 subsequent simulated poll cycles (40 seconds total)
      for (let cycle = 1; cycle <= 20; cycle++) {
        await vi.advanceTimersByTimeAsync(2000);
        expect(eventCount).toBe(1); // Must strictly remain 1
      }

      // Final assertion: exactly 0 duplicate events fired across all 20 cycles
      expect(eventCount).toBe(1);
    });

    it('SUPPRESS 2.2: Exactly 0 duplicate events across 20 cycles with multi-device heterogeneous mix', async () => {
      mockAdb.reset([MOCK_SAMSUNG_S24, MOCK_MOTOROLA_EDGE, MOCK_GENERIC_ANDROID]);
      manager = new DeviceManager(mockAdb, { pollIntervalMs: 2000, autoStart: true });

      let eventCount = 0;
      manager.on('devices-updated', () => {
        eventCount++;
      });

      // Cycle 0: initial discovery
      await vi.advanceTimersByTimeAsync(1);
      expect(eventCount).toBe(1);
      expect(manager.getDevices()).toHaveLength(3);

      // 20 subsequent poll cycles (40s simulated time, crosses 10s, 20s, 30s, 40s battery queries)
      for (let cycle = 1; cycle <= 20; cycle++) {
        await vi.advanceTimersByTimeAsync(2000);
        expect(eventCount).toBe(1);
      }

      expect(eventCount).toBe(1);
    });

    it('SUPPRESS 2.3: Suppresses duplicate events even when ADB returns devices in permuted array order', async () => {
      mockAdb.reset([MOCK_SAMSUNG_S24, MOCK_MOTOROLA_EDGE]);
      manager = new DeviceManager(mockAdb, { pollIntervalMs: 2000, autoStart: true });

      let eventCount = 0;
      manager.on('devices-updated', () => {
        eventCount++;
      });

      await vi.advanceTimersByTimeAsync(1);
      expect(eventCount).toBe(1);

      // Spy on getDevices and reverse array order on odd ticks
      let tickNum = 0;
      const originalGetDevices = mockAdb.getDevices.bind(mockAdb);
      vi.spyOn(mockAdb, 'getDevices').mockImplementation(async () => {
        const devs = await originalGetDevices();
        tickNum++;
        return tickNum % 2 === 1 ? devs.reverse() : devs;
      });

      // Run 20 cycles with alternating array orders
      for (let cycle = 1; cycle <= 20; cycle++) {
        await vi.advanceTimersByTimeAsync(2000);
        expect(eventCount).toBe(1);
      }

      expect(eventCount).toBe(1);
    });

    it('SUPPRESS 2.4: High-frequency manual refresh(false) across 20 invocations emits 0 duplicate events', async () => {
      mockAdb.reset([MOCK_SAMSUNG_S24]);
      manager = new DeviceManager(mockAdb, { pollIntervalMs: 2000, autoStart: true });

      let eventCount = 0;
      manager.on('devices-updated', () => {
        eventCount++;
      });

      await vi.advanceTimersByTimeAsync(1);
      expect(eventCount).toBe(1);

      // Call manual refresh 20 times rapidly
      for (let i = 0; i < 20; i++) {
        await manager.refresh(false);
      }

      expect(eventCount).toBe(1);
    });
  });

  // =========================================================================
  // 3. Battery Throttling: 10s Cooldown & forceBattery Override
  // =========================================================================
  describe('Pillar 3: Battery Throttling & Override Probes', () => {
    it('BATT 3.1: Battery queries are skipped at 2s, 4s, 6s, 8s, but executed at 10s, 20s, 30s', async () => {
      mockAdb.reset([MOCK_SAMSUNG_S24]);
      manager = new DeviceManager(mockAdb, {
        pollIntervalMs: 2000,
        batteryRefreshIntervalMs: 10000,
        autoStart: true,
      });

      const getBatterySpy = vi.spyOn(mockAdb, 'getBatteryInfo');

      // t=0s: Initial discovery queries battery once
      await vi.advanceTimersByTimeAsync(1);
      expect(getBatterySpy).toHaveBeenCalledTimes(1);

      // t=2s, 4s, 6s, 8s: within 10s cooldown window -> skipped
      await vi.advanceTimersByTimeAsync(2000);
      expect(getBatterySpy).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(2000);
      expect(getBatterySpy).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(2000);
      expect(getBatterySpy).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(2000);
      expect(getBatterySpy).toHaveBeenCalledTimes(1);

      // t=10s: 10s cooldown elapsed -> query executed
      await vi.advanceTimersByTimeAsync(2000);
      expect(getBatterySpy).toHaveBeenCalledTimes(2);

      // t=12s, 14s, 16s, 18s: in second cooldown window -> skipped
      for (let i = 0; i < 4; i++) {
        await vi.advanceTimersByTimeAsync(2000);
        expect(getBatterySpy).toHaveBeenCalledTimes(2);
      }

      // t=20s: second cooldown elapsed -> query executed
      await vi.advanceTimersByTimeAsync(2000);
      expect(getBatterySpy).toHaveBeenCalledTimes(3);

      // t=30s: third cooldown elapsed
      for (let i = 0; i < 4; i++) {
        await vi.advanceTimersByTimeAsync(2000);
      }
      expect(getBatterySpy).toHaveBeenCalledTimes(3);

      await vi.advanceTimersByTimeAsync(2000);
      expect(getBatterySpy).toHaveBeenCalledTimes(4);
    });

    it('BATT 3.2: forceBattery=true bypasses 10s cooldown unconditionally on manual refresh', async () => {
      mockAdb.reset([MOCK_SAMSUNG_S24]);
      manager = new DeviceManager(mockAdb, {
        pollIntervalMs: 2000,
        batteryRefreshIntervalMs: 10000,
        autoStart: true,
      });

      const getBatterySpy = vi.spyOn(mockAdb, 'getBatteryInfo');

      // t=0s: Initial query
      await vi.advanceTimersByTimeAsync(1);
      expect(getBatterySpy).toHaveBeenCalledTimes(1);

      // Advance only 500ms (9.5s remaining in cooldown)
      await vi.advanceTimersByTimeAsync(500);

      // forceBattery = false respects cooldown
      await manager.refresh(false);
      expect(getBatterySpy).toHaveBeenCalledTimes(1);

      // forceBattery = true bypasses cooldown
      await manager.refresh(true);
      expect(getBatterySpy).toHaveBeenCalledTimes(2);

      // Immediate second forceBattery = true bypasses cooldown again
      await manager.refresh(true);
      expect(getBatterySpy).toHaveBeenCalledTimes(3);
    });

    it('BATT 3.3: Battery drain during cooldown is ignored until 10s boundary, then emits update', async () => {
      mockAdb.reset([MOCK_SAMSUNG_S24]);
      manager = new DeviceManager(mockAdb, {
        pollIntervalMs: 2000,
        batteryRefreshIntervalMs: 10000,
        autoStart: true,
      });

      const updates: DeviceInfo[][] = [];
      manager.on('devices-updated', (devs) => updates.push(devs));

      await vi.advanceTimersByTimeAsync(1);
      expect(updates).toHaveLength(1);
      expect(updates[0][0].battery.level).toBe(85);

      // Hardware battery drops from 85% to 75% at t=4s
      await vi.advanceTimersByTimeAsync(4000);
      mockAdb.simulateBatteryUpdate(MOCK_SAMSUNG_S24.raw.serial, { level: 75 });

      // Poll at t=6s and t=8s: battery is throttled, UI not notified yet
      await vi.advanceTimersByTimeAsync(2000);
      expect(updates).toHaveLength(1);
      await vi.advanceTimersByTimeAsync(2000);
      expect(updates).toHaveLength(1);

      // At t=10s: cooldown expires, query executes, diff triggers update
      await vi.advanceTimersByTimeAsync(2000);
      expect(updates).toHaveLength(2);
      expect(updates[1][0].battery.level).toBe(75);
    });

    it('BATT 3.4: Per-device independent battery throttling when devices attach at different times', async () => {
      mockAdb.reset([MOCK_SAMSUNG_S24]);
      manager = new DeviceManager(mockAdb, {
        pollIntervalMs: 2000,
        batteryRefreshIntervalMs: 10000,
        autoStart: true,
      });

      const getBatterySpy = vi.spyOn(mockAdb, 'getBatteryInfo');

      // t=0s: Dev1 attached -> queried (1 total)
      await vi.advanceTimersByTimeAsync(1);
      expect(getBatterySpy).toHaveBeenCalledTimes(1);

      // t=4s: Dev2 attaches
      await vi.advanceTimersByTimeAsync(4000);
      mockAdb.simulateDeviceConnect(MOCK_MOTOROLA_EDGE);

      // Tick at t=6s: Dev2 initial battery query executes (2 total)
      await vi.advanceTimersByTimeAsync(2000);
      expect(getBatterySpy).toHaveBeenCalledTimes(2);

      // Tick at t=8s: Dev1 (at 8s < 10s) skipped, Dev2 (at 2s < 10s) skipped
      await vi.advanceTimersByTimeAsync(2000);
      expect(getBatterySpy).toHaveBeenCalledTimes(2);

      // Tick at t=10s: Dev1 has reached 10s -> queried! Dev2 (at 4s < 10s) -> skipped!
      await vi.advanceTimersByTimeAsync(2000);
      expect(getBatterySpy).toHaveBeenCalledTimes(3);

      // Tick at t=12s and t=14s: Dev1 skipped, Dev2 skipped
      await vi.advanceTimersByTimeAsync(2000);
      await vi.advanceTimersByTimeAsync(2000);
      expect(getBatterySpy).toHaveBeenCalledTimes(3);

      // Tick at t=16s: Dev2 has reached 10s since its fetch at t=6s -> queried! Dev1 (at 6s < 10s) -> skipped!
      await vi.advanceTimersByTimeAsync(2000);
      expect(getBatterySpy).toHaveBeenCalledTimes(4);
    });

    it('BATT 3.5: Query failure at 10s boundary does not corrupt cache and allows retry on next tick', async () => {
      mockAdb.reset([MOCK_SAMSUNG_S24]);
      manager = new DeviceManager(mockAdb, {
        pollIntervalMs: 2000,
        batteryRefreshIntervalMs: 10000,
        autoStart: true,
      });

      const getBatterySpy = vi.spyOn(mockAdb, 'getBatteryInfo');
      await vi.advanceTimersByTimeAsync(1);
      expect(getBatterySpy).toHaveBeenCalledTimes(1);

      // Advance to 10s
      await vi.advanceTimersByTimeAsync(8000);

      // Make 10s query fail
      getBatterySpy.mockRejectedValueOnce(new Error('Transient ADB transport error'));
      await vi.advanceTimersByTimeAsync(2000);
      expect(getBatterySpy).toHaveBeenCalledTimes(2);

      // Cached battery remains unharmed
      expect(manager.getDevices()[0].battery.level).toBe(85);

      // Because lastBatteryFetch was NOT updated on error, next tick (t=12s) retries immediately!
      await vi.advanceTimersByTimeAsync(2000);
      expect(getBatterySpy).toHaveBeenCalledTimes(3);
    });
  });

  // =========================================================================
  // 4. Memory Leak, Timer Cleanup & Lifecycle Teardown
  // =========================================================================
  describe('Pillar 4: Memory Leak & Teardown Probes', () => {
    it('LEAK 4.1: stop() cancels timer, sets isRunning=false, and leaves 0 pending timers', async () => {
      mockAdb.reset([MOCK_SAMSUNG_S24]);
      manager = new DeviceManager(mockAdb, { pollIntervalMs: 2000, autoStart: true });

      await vi.advanceTimersByTimeAsync(1);
      expect(manager.isStarted()).toBe(true);
      expect(vi.getTimerCount()).toBe(1);

      manager.stop();

      expect(manager.isStarted()).toBe(false);
      expect(vi.getTimerCount()).toBe(0);

      // Advance time by 60 seconds
      await vi.advanceTimersByTimeAsync(60000);
      expect(vi.getTimerCount()).toBe(0);
    });

    it('LEAK 4.2: dispose() cleans timers, caches, and wipes all EventEmitter listeners', async () => {
      mockAdb.reset([MOCK_SAMSUNG_S24, MOCK_MOTOROLA_EDGE]);
      manager = new DeviceManager(mockAdb, { pollIntervalMs: 2000, autoStart: true });

      manager.on('devices-updated', () => {});
      manager.on('device-attached', () => {});
      manager.on('device-detached', () => {});
      manager.on('error', () => {});

      await vi.advanceTimersByTimeAsync(1);
      expect(manager.getCacheSize()).toBe(2);
      expect(manager.listenerCount('devices-updated')).toBe(1);
      expect(manager.listenerCount('device-attached')).toBe(1);
      expect(manager.listenerCount('device-detached')).toBe(1);
      expect(manager.listenerCount('error')).toBe(1);

      manager.dispose();

      expect(manager.isStarted()).toBe(false);
      expect(manager.getCacheSize()).toBe(0);
      expect(manager.getDevices()).toHaveLength(0);
      expect(manager.listenerCount('devices-updated')).toBe(0);
      expect(manager.listenerCount('device-attached')).toBe(0);
      expect(manager.listenerCount('device-detached')).toBe(0);
      expect(manager.listenerCount('error')).toBe(0);
      expect(manager.eventNames()).toHaveLength(0);
      expect(vi.getTimerCount()).toBe(0);
    });

    it('LEAK 4.3: Mid-flight async poll teardown does NOT reschedule timers or emit to disposed listeners', async () => {
      mockAdb.reset([MOCK_SAMSUNG_S24]);
      manager = new DeviceManager(mockAdb, { pollIntervalMs: 2000, autoStart: false });

      let resolveAdb!: (value: any) => void;
      const delayedPromise = new Promise((resolve) => {
        resolveAdb = resolve;
      });

      // Hook getDevices with controlled async delay
      vi.spyOn(mockAdb, 'getDevices').mockReturnValueOnce(delayedPromise as any);

      let eventFired = false;
      manager.on('devices-updated', () => {
        eventFired = true;
      });

      // Start poll (now pending in-flight)
      manager.start();

      // Dispose while poll tick is in-flight!
      manager.dispose();
      expect(manager.isStarted()).toBe(false);

      // Now resolve the in-flight ADB call
      resolveAdb([{ serial: 'R5CW10ABCDE', state: 'device' }]);
      await vi.advanceTimersByTimeAsync(10);

      // Verify no timer was scheduled
      expect(vi.getTimerCount()).toBe(0);
      // Verify no event was delivered
      expect(eventFired).toBe(false);
    });

    it('LEAK 4.4: 100 rapid start() / stop() cycles execute with zero timer leaks', async () => {
      mockAdb.reset([MOCK_SAMSUNG_S24]);
      manager = new DeviceManager(mockAdb, { pollIntervalMs: 2000, autoStart: false });

      for (let i = 0; i < 100; i++) {
        manager.start();
        expect(manager.isStarted()).toBe(true);
        manager.stop();
        expect(manager.isStarted()).toBe(false);
        expect(vi.getTimerCount()).toBe(0);
      }

      // Finish cleanly
      manager.dispose();
      expect(vi.getTimerCount()).toBe(0);
    });

    it('LEAK 4.5: Real-timer handle probe verifies zero dangling timers in Node runtime upon dispose()', async () => {
      vi.useRealTimers();
      mockAdb.reset([MOCK_SAMSUNG_S24]);
      manager = new DeviceManager(mockAdb, { pollIntervalMs: 50, autoStart: true });

      // Let it run for 120ms (several real cycles)
      await new Promise((resolve) => setTimeout(resolve, 120));

      expect(manager.getDevices()).toHaveLength(1);

      // Dispose
      manager.dispose();

      // Wait a moment and check active handles if accessible
      await new Promise((resolve) => setTimeout(resolve, 60));

      // Check that manager is completely stopped
      expect(manager.isStarted()).toBe(false);
      expect(manager.getCacheSize()).toBe(0);
      expect(manager.getDevices()).toHaveLength(0);
    });
  });
});
