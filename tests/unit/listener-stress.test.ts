import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventEmitter } from 'node:events';
import { DEXCONNECT_CHANNELS } from '../../electron/main/ipc/channels';
import type { DeviceInfo, ActiveSession, SessionLogEntry } from '../../src/types';

// Real Node.js EventEmitter backed ipcRenderer mock
class RealEventEmitterIpcRenderer extends EventEmitter {
  invoke = vi.fn();
}

const mockIpc = new RealEventEmitterIpcRenderer();

vi.mock('electron', () => ({
  ipcRenderer: {
    invoke: (...args: any[]) => mockIpc.invoke(...args),
    on: (channel: string, listener: (...args: any[]) => void) => mockIpc.on(channel, listener),
    removeListener: (channel: string, listener: (...args: any[]) => void) =>
      mockIpc.removeListener(channel, listener),
    listenerCount: (channel: string) => mockIpc.listenerCount(channel),
  },
}));

// Import preload API
import { dexconnectAPI } from '../../electron/preload/api';

describe('Adversarial Stress Test: Preload Listener Lifecycle & Memory Leaks', () => {
  beforeEach(() => {
    mockIpc.removeAllListeners();
    mockIpc.invoke.mockReset();
    // Default max listeners in EventEmitter is 10; increase to avoid warning during stress tests
    mockIpc.setMaxListeners(2000);
  });

  describe('1. Push Listener Attachment and Detachment Verification', () => {
    it('onDevicesUpdated: increments listenerCount, receives payload, cleans up on unsubscribe', () => {
      expect(mockIpc.listenerCount(DEXCONNECT_CHANNELS.DEVICES_UPDATED)).toBe(0);

      const calls: DeviceInfo[][] = [];
      const unsub = dexconnectAPI.onDevicesUpdated((devices) => {
        calls.push(devices);
      });

      expect(mockIpc.listenerCount(DEXCONNECT_CHANNELS.DEVICES_UPDATED)).toBe(1);

      const fakeDevices: DeviceInfo[] = [
        {
          serial: 'DEVICE1',
          state: 'device',
          brand: 'samsung',
          manufacturer: 'Samsung',
          model: 'Galaxy S24',
          androidVersion: '14',
          connectionType: 'usb',
          battery: { level: 90, scale: 100, status: 2, isCharging: true, powerSource: 'usb' },
        },
      ];

      // Emit simulated IPC event from main process: (event, payload)
      mockIpc.emit(DEXCONNECT_CHANNELS.DEVICES_UPDATED, {}, fakeDevices);
      expect(calls).toHaveLength(1);
      expect(calls[0]).toEqual(fakeDevices);

      // Unsubscribe and verify listener is removed from emitter
      unsub();
      expect(mockIpc.listenerCount(DEXCONNECT_CHANNELS.DEVICES_UPDATED)).toBe(0);

      // Subsequent emits must NOT invoke callback
      mockIpc.emit(DEXCONNECT_CHANNELS.DEVICES_UPDATED, {}, fakeDevices);
      expect(calls).toHaveLength(1);
    });

    it('onSessionStatusChanged: increments listenerCount, receives payload, cleans up on unsubscribe', () => {
      expect(mockIpc.listenerCount(DEXCONNECT_CHANNELS.SESSION_STATUS_CHANGED)).toBe(0);

      const statuses: ActiveSession[] = [];
      const unsub = dexconnectAPI.onSessionStatusChanged((session) => {
        statuses.push(session);
      });

      expect(mockIpc.listenerCount(DEXCONNECT_CHANNELS.SESSION_STATUS_CHANGED)).toBe(1);

      const fakeSession: ActiveSession = {
        sessionId: 'sess_1',
        deviceSerial: 'DEVICE1',
        profile: 'samsung_dex',
        pid: 1234,
        startedAt: new Date().toISOString(),
        config: {
          serial: 'DEVICE1',
          profile: 'samsung_dex',
          resolution: '1440p',
          dpi: 240,
          refreshRate: 60,
          codec: 'h264',
          audioRouting: true,
          modelName: 'Galaxy S24',
        },
        status: 'running',
      };

      mockIpc.emit(DEXCONNECT_CHANNELS.SESSION_STATUS_CHANGED, {}, fakeSession);
      expect(statuses).toHaveLength(1);
      expect(statuses[0].status).toBe('running');

      unsub();
      expect(mockIpc.listenerCount(DEXCONNECT_CHANNELS.SESSION_STATUS_CHANGED)).toBe(0);

      mockIpc.emit(DEXCONNECT_CHANNELS.SESSION_STATUS_CHANGED, {}, fakeSession);
      expect(statuses).toHaveLength(1);
    });

    it('onSessionLog: increments listenerCount, receives payload, cleans up on unsubscribe', () => {
      expect(mockIpc.listenerCount(DEXCONNECT_CHANNELS.SESSION_LOG)).toBe(0);

      const logs: SessionLogEntry[] = [];
      const unsub = dexconnectAPI.onSessionLog((log) => {
        logs.push(log);
      });

      expect(mockIpc.listenerCount(DEXCONNECT_CHANNELS.SESSION_LOG)).toBe(1);

      const fakeLog: SessionLogEntry = {
        sessionId: 'sess_1',
        text: 'Device connected to display',
      };

      mockIpc.emit(DEXCONNECT_CHANNELS.SESSION_LOG, {}, fakeLog);
      expect(logs).toHaveLength(1);
      expect(logs[0].text).toBe('Device connected to display');

      unsub();
      expect(mockIpc.listenerCount(DEXCONNECT_CHANNELS.SESSION_LOG)).toBe(0);

      mockIpc.emit(DEXCONNECT_CHANNELS.SESSION_LOG, {}, fakeLog);
      expect(logs).toHaveLength(1);
    });
  });

  describe('2. High-Frequency Repeated Attachment / Detachment Churn', () => {
    it('executes 1,000 attach/detach cycles for onDevicesUpdated without listener leaks', () => {
      const initialCount = mockIpc.listenerCount(DEXCONNECT_CHANNELS.DEVICES_UPDATED);
      expect(initialCount).toBe(0);

      for (let i = 0; i < 1000; i++) {
        const unsub = dexconnectAPI.onDevicesUpdated(() => {});
        expect(mockIpc.listenerCount(DEXCONNECT_CHANNELS.DEVICES_UPDATED)).toBe(1);
        unsub();
        expect(mockIpc.listenerCount(DEXCONNECT_CHANNELS.DEVICES_UPDATED)).toBe(0);
      }

      expect(mockIpc.listenerCount(DEXCONNECT_CHANNELS.DEVICES_UPDATED)).toBe(0);
    });

    it('executes 1,000 attach/detach cycles for onSessionStatusChanged without listener leaks', () => {
      for (let i = 0; i < 1000; i++) {
        const unsub = dexconnectAPI.onSessionStatusChanged(() => {});
        unsub();
      }
      expect(mockIpc.listenerCount(DEXCONNECT_CHANNELS.SESSION_STATUS_CHANGED)).toBe(0);
    });

    it('executes 1,000 attach/detach cycles for onSessionLog without listener leaks', () => {
      for (let i = 0; i < 1000; i++) {
        const unsub = dexconnectAPI.onSessionLog(() => {});
        unsub();
      }
      expect(mockIpc.listenerCount(DEXCONNECT_CHANNELS.SESSION_LOG)).toBe(0);
    });
  });

  describe('3. Multi-Subscriber Concurrency & Selective Teardown', () => {
    it('supports 100 concurrent subscribers and cleans up selectively', () => {
      const listenerCount = 100;
      const unsubs: Array<() => void> = [];
      const counters = new Array(listenerCount).fill(0);

      for (let i = 0; i < listenerCount; i++) {
        const idx = i;
        const unsub = dexconnectAPI.onDevicesUpdated(() => {
          counters[idx]++;
        });
        unsubs.push(unsub);
      }

      expect(mockIpc.listenerCount(DEXCONNECT_CHANNELS.DEVICES_UPDATED)).toBe(100);

      // Emit event
      mockIpc.emit(DEXCONNECT_CHANNELS.DEVICES_UPDATED, {}, []);
      expect(counters.every((c) => c === 1)).toBe(true);

      // Unsubscribe even indexed listeners (50 of them)
      for (let i = 0; i < listenerCount; i += 2) {
        unsubs[i]();
      }

      expect(mockIpc.listenerCount(DEXCONNECT_CHANNELS.DEVICES_UPDATED)).toBe(50);

      // Emit second event
      mockIpc.emit(DEXCONNECT_CHANNELS.DEVICES_UPDATED, {}, []);

      // Even listeners should still have count 1, odd listeners should now have count 2
      for (let i = 0; i < listenerCount; i++) {
        if (i % 2 === 0) {
          expect(counters[i]).toBe(1);
        } else {
          expect(counters[i]).toBe(2);
        }
      }

      // Unsubscribe remaining odd listeners
      for (let i = 1; i < listenerCount; i += 2) {
        unsubs[i]();
      }

      expect(mockIpc.listenerCount(DEXCONNECT_CHANNELS.DEVICES_UPDATED)).toBe(0);

      // Emit third event: no subscriber increments
      mockIpc.emit(DEXCONNECT_CHANNELS.DEVICES_UPDATED, {}, []);
      for (let i = 1; i < listenerCount; i += 2) {
        expect(counters[i]).toBe(2);
      }
    });
  });

  describe('4. Idempotence & Channel Isolation', () => {
    it('calling unsubscribe multiple times is safe and idempotent', () => {
      let callCount = 0;
      const unsub = dexconnectAPI.onDevicesUpdated(() => {
        callCount++;
      });

      expect(mockIpc.listenerCount(DEXCONNECT_CHANNELS.DEVICES_UPDATED)).toBe(1);

      // Call unsub multiple times consecutively
      unsub();
      unsub();
      unsub();
      unsub();

      expect(mockIpc.listenerCount(DEXCONNECT_CHANNELS.DEVICES_UPDATED)).toBe(0);

      mockIpc.emit(DEXCONNECT_CHANNELS.DEVICES_UPDATED, {}, []);
      expect(callCount).toBe(0);
    });

    it('events on one channel do not trigger callbacks on other channels', () => {
      let devicesCalls = 0;
      let sessionCalls = 0;
      let logCalls = 0;

      const unsubDev = dexconnectAPI.onDevicesUpdated(() => devicesCalls++);
      const unsubSess = dexconnectAPI.onSessionStatusChanged(() => sessionCalls++);
      const unsubLog = dexconnectAPI.onSessionLog(() => logCalls++);

      expect(mockIpc.listenerCount(DEXCONNECT_CHANNELS.DEVICES_UPDATED)).toBe(1);
      expect(mockIpc.listenerCount(DEXCONNECT_CHANNELS.SESSION_STATUS_CHANGED)).toBe(1);
      expect(mockIpc.listenerCount(DEXCONNECT_CHANNELS.SESSION_LOG)).toBe(1);

      // Emit to SESSION_LOG only
      mockIpc.emit(DEXCONNECT_CHANNELS.SESSION_LOG, {}, { sessionId: 's1', text: 'hi' });
      expect(devicesCalls).toBe(0);
      expect(sessionCalls).toBe(0);
      expect(logCalls).toBe(1);

      // Clean all
      unsubDev();
      unsubSess();
      unsubLog();

      expect(mockIpc.listenerCount(DEXCONNECT_CHANNELS.DEVICES_UPDATED)).toBe(0);
      expect(mockIpc.listenerCount(DEXCONNECT_CHANNELS.SESSION_STATUS_CHANGED)).toBe(0);
      expect(mockIpc.listenerCount(DEXCONNECT_CHANNELS.SESSION_LOG)).toBe(0);
    });
  });

  describe('5. WeakRef Garbage Collection Verification', () => {
    it('detaching listener releases callback reference from active emitter list', () => {
      let callbackInvoked = false;
      let cb: ((devs: DeviceInfo[]) => void) | null = (_devs: DeviceInfo[]) => {
        callbackInvoked = true;
      };

      const unsub = dexconnectAPI.onDevicesUpdated(cb);
      expect(mockIpc.listenerCount(DEXCONNECT_CHANNELS.DEVICES_UPDATED)).toBe(1);

      // Unsubscribe and nullify callback reference
      unsub();
      cb = null;

      expect(mockIpc.listenerCount(DEXCONNECT_CHANNELS.DEVICES_UPDATED)).toBe(0);
      const registeredListeners = mockIpc.listeners(DEXCONNECT_CHANNELS.DEVICES_UPDATED);
      expect(registeredListeners).toHaveLength(0);
      expect(callbackInvoked).toBe(false);
    });
  });

  describe('6. Extreme Churn & Callback Exception Resilience', () => {
    it('survives 5,000 interleaved attach/detach operations across all 3 channels simultaneously', () => {
      const totalOps = 5000;
      const activeUnsubs: Array<() => void> = [];

      for (let i = 0; i < totalOps; i++) {
        const mod = i % 3;
        if (mod === 0) {
          activeUnsubs.push(dexconnectAPI.onDevicesUpdated(() => {}));
        } else if (mod === 1) {
          activeUnsubs.push(dexconnectAPI.onSessionStatusChanged(() => {}));
        } else {
          activeUnsubs.push(dexconnectAPI.onSessionLog(() => {}));
        }

        // Periodically batch-drain unsubs to simulate bursty component mounting/unmounting
        if (activeUnsubs.length >= 50) {
          while (activeUnsubs.length > 0) {
            const unsub = activeUnsubs.pop()!;
            unsub();
          }
        }
      }

      // Drain remaining
      while (activeUnsubs.length > 0) {
        activeUnsubs.pop()!();
      }

      expect(mockIpc.listenerCount(DEXCONNECT_CHANNELS.DEVICES_UPDATED)).toBe(0);
      expect(mockIpc.listenerCount(DEXCONNECT_CHANNELS.SESSION_STATUS_CHANGED)).toBe(0);
      expect(mockIpc.listenerCount(DEXCONNECT_CHANNELS.SESSION_LOG)).toBe(0);
    });

    it('cleans up cleanly even if user callback threw an error previously', () => {
      const errorCb = () => {
        throw new Error('Exploding user callback');
      };

      const unsub = dexconnectAPI.onDevicesUpdated(errorCb);
      expect(mockIpc.listenerCount(DEXCONNECT_CHANNELS.DEVICES_UPDATED)).toBe(1);

      // Emitting causes user callback to throw
      expect(() => {
        mockIpc.emit(DEXCONNECT_CHANNELS.DEVICES_UPDATED, {}, []);
      }).toThrow('Exploding user callback');

      // Unsubscribe still works cleanly
      unsub();
      expect(mockIpc.listenerCount(DEXCONNECT_CHANNELS.DEVICES_UPDATED)).toBe(0);

      // Emitting again does not throw because listener is removed
      expect(() => {
        mockIpc.emit(DEXCONNECT_CHANNELS.DEVICES_UPDATED, {}, []);
      }).not.toThrow();
    });
  });
});

