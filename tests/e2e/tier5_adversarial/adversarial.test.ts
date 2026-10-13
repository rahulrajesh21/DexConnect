import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { MockAdbExecutor } from '../../../electron/main/adapters/MockAdbExecutor';
import { MockScrcpyRunner } from '../../../electron/main/adapters/MockScrcpyRunner';
import { DeviceManager } from '../../../electron/main/services/DeviceManager';
import { SessionLauncher } from '../../../electron/main/services/SessionLauncher';
import { RecentDevicesStore, InMemoryRecentDevicesStorage } from '../../../electron/main/services/RecentDevicesStore';
import { MOCK_SAMSUNG_S24 } from '../../fixtures/mockDevices';

describe('Tier 5: Adversarial Hardening & Resilience Suite', () => {
  let adb: MockAdbExecutor;
  let scrcpy: MockScrcpyRunner;
  let devManager: DeviceManager;
  let launcher: SessionLauncher;
  let store: RecentDevicesStore;

  beforeEach(async () => {
    adb = new MockAdbExecutor([]);
    scrcpy = new MockScrcpyRunner();
    devManager = new DeviceManager(adb, { pollIntervalMs: 100 });
    launcher = new SessionLauncher(scrcpy);
    store = new RecentDevicesStore({ storage: new InMemoryRecentDevicesStorage() });
  });

  afterEach(() => {
    devManager.dispose();
    launcher.stopAllSessions();
  });

  it('ADV1: SIGTERM -> SIGKILL escalation on stubborn non-responsive child process', async () => {
    // Configure mock runner to ignore first SIGTERM
    scrcpy.simulateStubbornProcess = true;

    const res = await launcher.launchSession({
      serial: 'R5CW10ABCDE',
      profile: 'samsung_dex',
      resolution: '1080p',
      dpi: 200,
      refreshRate: 60,
      codec: 'h264',
      audioRouting: true,
      modelName: 'Galaxy S24 Ultra',
    });

    expect(res.success).toBe(true);
    const stopRes = await launcher.stopSession(res.sessionId!);
    expect(stopRes.success).toBe(true);
    expect(launcher.getActiveSessions().length).toBe(0);
  });

  it('ADV2: Rapid-fire start/stop flapping does not leak unmanaged processes', async () => {
    for (let i = 0; i < 5; i++) {
      const res = await launcher.launchSession({
        serial: `DEVICE_${i}`,
        profile: 'samsung_dex',
        resolution: '1080p',
        dpi: 200,
        refreshRate: 60,
        codec: 'h264',
        audioRouting: true,
        modelName: `Device ${i}`,
      });
      if (res.sessionId) {
        await launcher.stopSession(res.sessionId);
      }
    }
    expect(launcher.getActiveSessions().length).toBe(0);
  });

  it('ADV3: Event listener limits are maintained under high device churn', async () => {
    const initialListeners = devManager.listenerCount('devicesUpdated');

    for (let i = 0; i < 20; i++) {
      adb.setMockDevice({
        ...MOCK_SAMSUNG_S24,
        raw: { serial: `CHURN_${i}`, state: 'device' },
      });
      await devManager.refreshDevices();
      adb.removeMockDevice(`CHURN_${i}`);
      await devManager.refreshDevices();
    }

    expect(devManager.listenerCount('devicesUpdated')).toBe(initialListeners);
  });

  it('ADV4: Corrupted dumpsys battery output falls back to safe defaults without crashing', async () => {
    adb.simulateCorruptedBattery = true;
    adb.setMockDevice(MOCK_SAMSUNG_S24);

    const devs = await devManager.refreshDevices();
    expect(devs.length).toBe(1);
    expect(typeof devs[0].battery.level).toBe('number');
  });

  it('ADV5: Corrupted getprop output does not crash device detection pipeline', async () => {
    adb.simulateCorruptedGetprop = true;
    adb.setMockDevice(MOCK_SAMSUNG_S24);

    const devs = await devManager.refreshDevices();
    expect(devs.length).toBe(1);
    expect(devs[0].serial).toBe('R5CW10ABCDE');
  });
});
