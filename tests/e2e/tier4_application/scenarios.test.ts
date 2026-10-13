import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { MockAdbExecutor } from '../../../electron/main/adapters/MockAdbExecutor';
import { MockScrcpyRunner } from '../../../electron/main/adapters/MockScrcpyRunner';
import { DeviceManager } from '../../../electron/main/services/DeviceManager';
import { SessionLauncher } from '../../../electron/main/services/SessionLauncher';
import { WirelessWizard } from '../../../electron/main/services/WirelessWizard';
import { RecentDevicesStore, InMemoryRecentDevicesStorage } from '../../../electron/main/services/RecentDevicesStore';
import { MOCK_SAMSUNG_S24, MOCK_MOTOROLA_EDGE, MOCK_GENERIC_ANDROID } from '../../fixtures/mockDevices';

describe('Tier 4: Real-World Workload Scenarios & User Journeys', () => {
  let adb: MockAdbExecutor;
  let scrcpy: MockScrcpyRunner;
  let devManager: DeviceManager;
  let launcher: SessionLauncher;
  let store: RecentDevicesStore;
  let wizard: WirelessWizard;

  beforeEach(async () => {
    adb = new MockAdbExecutor([]);
    scrcpy = new MockScrcpyRunner();
    devManager = new DeviceManager(adb, { pollIntervalMs: 100 });
    launcher = new SessionLauncher(scrcpy);
    store = new RecentDevicesStore({ storage: new InMemoryRecentDevicesStorage() });
    wizard = new WirelessWizard(adb, { delayMs: 0, recentStore: store, deviceManager: devManager });
  });

  afterEach(() => {
    devManager.dispose();
    launcher.stopAllSessions();
  });

  it('Scenario 1: Pro Samsung DeX Workstation End-to-End Workflow', async () => {
    // 1. Device plugged in via USB
    adb.setMockDevice(MOCK_SAMSUNG_S24);
    const devs = await devManager.refreshDevices();
    expect(devs.length).toBe(1);
    expect(devs[0].brand).toBe('samsung');

    // 2. User selects 1440p QHD and 240 DPI with UHID passthrough and Audio
    const launchRes = await launcher.launchSession({
      serial: 'R5CW10ABCDE',
      profile: 'samsung_dex',
      resolution: '1440p',
      dpi: 240,
      refreshRate: 60,
      codec: 'h264',
      audioRouting: true,
      modelName: 'Galaxy S24 Ultra',
    });
    expect(launchRes.success).toBe(true);

    // 3. Verify process running
    const session = launcher.getActiveSession(launchRes.sessionId!);
    expect(session).toBeDefined();
    expect(session?.pid).toBeGreaterThan(0);

    // 4. Session logs stream
    const logs: string[] = [];
    launcher.on('sessionLog', (l) => logs.push(l.text));
    const proc = scrcpy.getSpawnedProcesses().find((p) => p.pid === session?.pid);
    proc?.emitStdout('[scrcpy] New display created: 2560x1440\n');
    expect(logs.some((l) => l.includes('2560x1440'))).toBe(true);

    // 5. User clicks "Stop Session"
    const stopRes = await launcher.stopSession(launchRes.sessionId!);
    expect(stopRes.success).toBe(true);
    expect(launcher.getActiveSessions().length).toBe(0);
  });

  it('Scenario 2: Motorola Smart Connect (Ready For) Productivity Workflow', async () => {
    // 1. Motorola Edge device attached
    adb.setMockDevice(MOCK_MOTOROLA_EDGE);
    const devs = await devManager.refreshDevices();
    expect(devs[0].brand).toBe('motorola');

    // 2. Launch Ready For profile
    const launchRes = await launcher.launchSession({
      serial: 'ZY22ABCD12',
      profile: 'motorola_ready_for',
      resolution: '1080p',
      dpi: 200,
      refreshRate: 90,
      codec: 'h265',
      audioRouting: true,
      modelName: 'Edge 50 Ultra',
    });
    expect(launchRes.success).toBe(true);

    // 3. User closes session cleanly
    await launcher.stopSession(launchRes.sessionId!);
    expect(launcher.getActiveSessions().length).toBe(0);
  });

  it('Scenario 3: Complete 1-Click USB-to-Wi-Fi Migration & Cable Unplug Journey', async () => {
    // 1. User starts on USB
    adb.setMockDevice(MOCK_SAMSUNG_S24);
    await devManager.refreshDevices();
    expect(devManager.getDevices()[0].connectionType).toBe('usb');

    // 2. User clicks "Switch to Wi-Fi"
    const migRes = await wizard.migrateToWifi('R5CW10ABCDE');
    expect(migRes.success).toBe(true);
    expect(migRes.ip).toBe('192.168.1.101');

    // 3. User unplugs USB cable
    adb.removeMockDevice('R5CW10ABCDE');
    const updated = await devManager.refreshDevices();

    // Wi-Fi device is still connected and accessible
    const wifiDev = updated.find((d) => d.connectionType === 'wifi');
    expect(wifiDev).toBeDefined();
    expect(wifiDev?.serial).toBe('192.168.1.101:5555');

    // 4. Paired endpoint remembered in Recent Devices store
    const recents = store.getRecentDevices();
    expect(recents.some((r) => r.ip === '192.168.1.101')).toBe(true);
  });

  it('Scenario 4: Low-Latency Screen Mirror with Phone Screen Off', async () => {
    adb.setMockDevice(MOCK_GENERIC_ANDROID);
    await devManager.refreshDevices();

    const launchRes = await launcher.launchSession({
      serial: '192.168.1.103:5555',
      profile: 'screen_mirror',
      resolution: '1080p',
      dpi: 200,
      refreshRate: 60,
      codec: 'h264',
      audioRouting: false,
      modelName: 'Pixel 8 Pro',
    });

    expect(launchRes.success).toBe(true);
    const proc = scrcpy.getSpawnedProcesses().find((p) => p.pid === launcher.getActiveSession(launchRes.sessionId!)?.pid);
    expect(proc?.args).toContain('--turn-screen-off');
    expect(proc?.args).toContain('--stay-awake');
  });

  it('Scenario 5: Android 11+ Cordless Pairing and Reconnect Journey', async () => {
    // 1. Initial empty state
    expect(store.getRecentDevices().length).toBe(0);

    // 2. User enters pairing code from phone developer settings
    adb.simulateDeviceConnect({
      ...MOCK_SAMSUNG_S24,
      raw: { serial: 'R5CW10PAIR', state: 'device' },
      ipAddress: '192.168.1.200',
    });
    const pairRes = await wizard.pairDevice('192.168.1.200', 42111, '847291', 5555);
    expect(pairRes.success).toBe(true);

    // 3. Verify device is in recent store
    expect(store.getRecentDevices().some((d) => d.ip === '192.168.1.200')).toBe(true);

    // 4. Reconnect on next app launch via 1-click connect
    const reconnectRes = await wizard.connectWireless('192.168.1.200', 5555);
    expect(reconnectRes.success).toBe(true);
  });
});
