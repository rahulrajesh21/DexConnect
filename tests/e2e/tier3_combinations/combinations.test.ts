import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { MockAdbExecutor } from '../../../electron/main/adapters/MockAdbExecutor';
import { MockScrcpyRunner } from '../../../electron/main/adapters/MockScrcpyRunner';
import { DeviceManager } from '../../../electron/main/services/DeviceManager';
import { SessionLauncher } from '../../../electron/main/services/SessionLauncher';
import { WirelessWizard } from '../../../electron/main/services/WirelessWizard';
import { RecentDevicesStore, InMemoryRecentDevicesStorage } from '../../../electron/main/services/RecentDevicesStore';
import { buildScrcpyArgs } from '../../../electron/main/services/scrcpyArgs';
import { MOCK_SAMSUNG_S24, MOCK_MOTOROLA_EDGE } from '../../fixtures/mockDevices';

describe('Tier 3: Pairwise Combinatorial Cross-Feature Testing', () => {
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

  it('C1: Combo: DeX + 4K + 320 DPI + 120 FPS + Audio Playback', () => {
    const args = buildScrcpyArgs({
      serial: 'R5CW10ABCDE',
      profile: 'samsung_dex',
      resolution: '4k',
      dpi: 320,
      refreshRate: 120,
      codec: 'h264',
      audioRouting: true,
      modelName: 'Galaxy S24 Ultra',
    });

    expect(args).toContain('--new-display=3840x2160/320');
    expect(args).toContain('--max-fps=120');
    expect(args).toContain('--audio-source=playback');
    expect(args).toContain('--keyboard=uhid');
    expect(args).toContain('--mouse=uhid');
  });

  it('C2: Combo: Ready For + 1440p + H.265 (HEVC) + Screen Off + 90 FPS', () => {
    const args = buildScrcpyArgs({
      serial: 'ZY22ABCD12',
      profile: 'motorola_ready_for',
      resolution: '1440p',
      dpi: 240,
      refreshRate: 90,
      codec: 'h265',
      audioRouting: true,
      modelName: 'Edge 50 Ultra',
    });

    expect(args).toContain('--new-display=2560x1440/240');
    expect(args).toContain('--video-codec=h265');
    expect(args).toContain('--max-fps=90');
    expect(args).toContain('--audio-source=playback');
  });

  it('C3: Combo: Cordless Migration followed immediately by DeX Session Launch', async () => {
    adb.setMockDevice(MOCK_SAMSUNG_S24);
    await devManager.refreshDevices();

    // 1. Migrate to Wi-Fi
    const migResult = await wizard.migrateToWifi('R5CW10ABCDE');
    expect(migResult.success).toBe(true);
    const wifiSerial = `${migResult.ip}:5555`;

    // 2. Launch DeX session on the newly migrated Wi-Fi endpoint
    const launchResult = await launcher.launchSession({
      serial: wifiSerial,
      profile: 'samsung_dex',
      resolution: '1440p',
      dpi: 240,
      refreshRate: 60,
      codec: 'h264',
      audioRouting: true,
      modelName: 'Galaxy S24 Ultra',
    });

    expect(launchResult.success).toBe(true);
    expect(launcher.getActiveSessions().length).toBe(1);
    expect(launcher.getActiveSessions()[0].deviceSerial).toBe(wifiSerial);
  });

  it('C4: Combo: Concurrent multi-device tracking (Samsung USB + Motorola Wi-Fi)', async () => {
    adb.setMockDevice(MOCK_SAMSUNG_S24);
    adb.setMockDevice({
      ...MOCK_MOTOROLA_EDGE,
      raw: { serial: '192.168.1.102:5555', state: 'device' },
      ipAddress: '192.168.1.102',
    });

    const devs = await devManager.refreshDevices();
    expect(devs.length).toBe(2);

    const samsung = devs.find((d) => d.brand === 'samsung');
    const moto = devs.find((d) => d.brand === 'motorola');

    expect(samsung?.connectionType).toBe('usb');
    expect(moto?.connectionType).toBe('wifi');

    // Launch sessions on both distinct devices simultaneously
    const sess1 = await launcher.launchSession({
      serial: samsung!.serial,
      profile: 'samsung_dex',
      resolution: '1080p',
      dpi: 200,
      refreshRate: 60,
      codec: 'h264',
      audioRouting: true,
      modelName: samsung!.model,
    });

    const sess2 = await launcher.launchSession({
      serial: moto!.serial,
      profile: 'motorola_ready_for',
      resolution: '1080p',
      dpi: 200,
      refreshRate: 60,
      codec: 'h264',
      audioRouting: true,
      modelName: moto!.model,
    });

    expect(sess1.success).toBe(true);
    expect(sess2.success).toBe(true);
    expect(launcher.getActiveSessions().length).toBe(2);
  });
});
