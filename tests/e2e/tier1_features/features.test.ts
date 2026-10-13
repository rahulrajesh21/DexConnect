import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { MockAdbExecutor } from '../../../electron/main/adapters/MockAdbExecutor';
import { MockScrcpyRunner } from '../../../electron/main/adapters/MockScrcpyRunner';
import { DeviceManager } from '../../../electron/main/services/DeviceManager';
import { SessionLauncher } from '../../../electron/main/services/SessionLauncher';
import { WirelessWizard } from '../../../electron/main/services/WirelessWizard';
import { RecentDevicesStore, InMemoryRecentDevicesStorage } from '../../../electron/main/services/RecentDevicesStore';
import { buildScrcpyArgs } from '../../../electron/main/services/scrcpyArgs';
import { MOCK_SAMSUNG_S24, MOCK_MOTOROLA_EDGE, MOCK_GENERIC_ANDROID } from '../../fixtures/mockDevices';
import type { LaunchConfig } from '../../../src/types';

describe('Tier 1: Comprehensive Feature Requirements Coverage', () => {
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

  // Feature 1: Toolchain & Environment
  describe('F1: Build, Toolchain & Environment Verification', () => {
    it('F1.1: System status validates ADB and scrcpy presence and version', async () => {
      const version = await scrcpy.checkVersion('/opt/homebrew/bin/scrcpy');
      expect(version).toContain('scrcpy 5.0.1');
    });

    it('F1.2: MockScrcpyRunner reports binary availability correctly', async () => {
      expect(await scrcpy.isAvailable('/opt/homebrew/bin/scrcpy')).toBe(true);
      expect(await scrcpy.isAvailable('/invalid/path/scrcpy')).toBe(false);
    });

    it('F1.3: MockAdbExecutor supports arbitrary raw command execution', async () => {
      const res = await adb.raw(['version']);
      expect(res.exitCode).toBe(0);
      expect(res.stdout).toContain('Android Debug Bridge');
    });

    it('F1.4: Scrcpy runner tracks running processes accurately', async () => {
      const proc = await scrcpy.spawn('/opt/homebrew/bin/scrcpy', ['-s', 'R5CW10ABCDE']);
      expect(scrcpy.isRunning(proc.pid)).toBe(true);
      proc.kill('SIGTERM');
      expect(proc.killed).toBe(true);
    });

    it('F1.5: Executed command history is fully auditable', async () => {
      await adb.getDevices();
      const history = adb.getCommandHistory();
      expect(history.length).toBeGreaterThan(0);
      expect(history[0]).toContain('devices');
    });
  });

  // Feature 2: Device Detection & Lifecycle
  describe('F2: Device Detection & Lifecycle Management', () => {
    it('F2.1: Discovers initial mock devices immediately upon poll', async () => {
      adb.setMockDevice(MOCK_SAMSUNG_S24);
      const devices = await devManager.refreshDevices();
      expect(devices.length).toBe(1);
      expect(devices[0].serial).toBe('R5CW10ABCDE');
      expect(devices[0].brand).toBe('samsung');
    });

    it('F2.2: Emits devicesUpdated event on device connection', async () => {
      let emitted = false;
      devManager.on('devicesUpdated', (devs) => {
        if (devs.length > 0) emitted = true;
      });

      adb.setMockDevice(MOCK_MOTOROLA_EDGE);
      await devManager.refreshDevices();
      expect(emitted).toBe(true);
    });

    it('F2.3: Correctly identifies USB vs Wi-Fi connection types', async () => {
      adb.setMockDevice(MOCK_SAMSUNG_S24); // USB serial
      adb.setMockDevice(MOCK_GENERIC_ANDROID); // IP:port serial
      const devices = await devManager.refreshDevices();

      const usbDev = devices.find((d) => d.serial === 'R5CW10ABCDE');
      const wifiDev = devices.find((d) => d.serial === '192.168.1.103:5555');

      expect(usbDev?.connectionType).toBe('usb');
      expect(wifiDev?.connectionType).toBe('wifi');
    });

    it('F2.4: Handles device disconnection cleanly without stale state', async () => {
      adb.setMockDevice(MOCK_SAMSUNG_S24);
      await devManager.refreshDevices();
      expect(devManager.getDevices().length).toBe(1);

      adb.removeMockDevice('R5CW10ABCDE');
      await devManager.refreshDevices();
      expect(devManager.getDevices().length).toBe(0);
    });

    it('F2.5: Retrieves device by serial lookup', async () => {
      adb.setMockDevice(MOCK_SAMSUNG_S24);
      await devManager.refreshDevices();
      const dev = devManager.getDevice('R5CW10ABCDE');
      expect(dev).toBeDefined();
      expect(dev?.manufacturer).toBe('samsung');
    });
  });

  // Feature 3: Device Properties & Battery
  describe('F3: Device Properties & Battery Supervision', () => {
    it('F3.1: Accurately identifies Samsung manufacturer and brand', async () => {
      adb.setMockDevice(MOCK_SAMSUNG_S24);
      const devs = await devManager.refreshDevices();
      expect(devs[0].brand).toBe('samsung');
      expect(devs[0].model).toBe('SM-S928B');
    });

    it('F3.2: Accurately identifies Motorola manufacturer and brand', async () => {
      adb.setMockDevice(MOCK_MOTOROLA_EDGE);
      const devs = await devManager.refreshDevices();
      expect(devs[0].brand).toBe('motorola');
      expect(devs[0].model).toBe('motorola edge 50 ultra');
    });

    it('F3.3: Accurately extracts Android OS version', async () => {
      adb.setMockDevice(MOCK_SAMSUNG_S24);
      const devs = await devManager.refreshDevices();
      expect(devs[0].androidVersion).toBe('14');
    });

    it('F3.4: Extracts battery percentage and charging state', async () => {
      adb.setMockDevice(MOCK_SAMSUNG_S24);
      const devs = await devManager.refreshDevices();
      expect(devs[0].battery.level).toBe(85);
      expect(devs[0].battery.isCharging).toBe(true);
      expect(devs[0].battery.powerSource).toBe('usb');
    });

    it('F3.5: Caches static device properties across refresh cycles', async () => {
      adb.setMockDevice(MOCK_SAMSUNG_S24);
      await devManager.refreshDevices();
      const initialCount = adb.getCommandHistory().length;

      // Second refresh should only query devices list and battery, not ro.product properties
      await devManager.refreshDevices();
      const secondCount = adb.getCommandHistory().length;
      expect(secondCount - initialCount).toBeLessThan(5);
    });
  });

  // Feature 4: Session Launching & Profiles
  describe('F4: Session Launching & Scrcpy Profiles', () => {
    it('F4.1: Samsung DeX profile generates --new-display and UHID flags', () => {
      const config: LaunchConfig = {
        serial: 'R5CW10ABCDE',
        profile: 'samsung_dex',
        resolution: '1440p',
        dpi: 240,
        refreshRate: 60,
        codec: 'h264',
        audioRouting: true,
        modelName: 'Galaxy S24 Ultra',
      };

      const args = buildScrcpyArgs(config);
      expect(args).toContain('--new-display=2560x1440/240');
      expect(args).toContain('--keyboard=uhid');
      expect(args).toContain('--mouse=uhid');
      expect(args).toContain('--audio-source=playback');
      expect(args).toContain('--stay-awake');
    });

    it('F4.2: Motorola Smart Connect profile generates virtual display', () => {
      const config: LaunchConfig = {
        serial: 'ZY22ABCD12',
        profile: 'motorola_ready_for',
        resolution: '1080p',
        dpi: 200,
        refreshRate: 90,
        codec: 'h265',
        audioRouting: true,
        modelName: 'Edge 50 Ultra',
      };

      const args = buildScrcpyArgs(config);
      expect(args).toContain('--new-display=1920x1080/200');
      expect(args).toContain('--video-codec=h265');
      expect(args).toContain('--max-fps=90');
    });

    it('F4.3: Screen mirror profile includes --turn-screen-off and no virtual display', () => {
      const config: LaunchConfig = {
        serial: 'R5CW10ABCDE',
        profile: 'screen_mirror',
        resolution: '1080p',
        dpi: 240,
        refreshRate: 60,
        codec: 'h264',
        audioRouting: false,
        modelName: 'S24 Ultra',
      };

      const args = buildScrcpyArgs(config);
      expect(args).toContain('--turn-screen-off');
      expect(args.some((a) => a.startsWith('--new-display'))).toBe(false);
      expect(args).toContain('--no-audio');
    });

    it('F4.4: Launcher successfully launches session and returns session ID', async () => {
      const config: LaunchConfig = {
        serial: 'R5CW10ABCDE',
        profile: 'samsung_dex',
        resolution: '1440p',
        dpi: 240,
        refreshRate: 60,
        codec: 'h264',
        audioRouting: true,
        modelName: 'Galaxy S24 Ultra',
      };

      const result = await launcher.launchSession(config);
      expect(result.success).toBe(true);
      expect(result.sessionId).toBeDefined();

      const active = launcher.getActiveSessions();
      expect(active.length).toBe(1);
      expect(active[0].status).toBe('running');
    });

    it('F4.5: Launcher enforces single session concurrency lock per device', async () => {
      const config: LaunchConfig = {
        serial: 'R5CW10ABCDE',
        profile: 'samsung_dex',
        resolution: '1440p',
        dpi: 240,
        refreshRate: 60,
        codec: 'h264',
        audioRouting: true,
        modelName: 'Galaxy S24 Ultra',
      };

      await launcher.launchSession(config);
      const secondResult = await launcher.launchSession(config);
      expect(secondResult.success).toBe(false);
      expect(secondResult.error).toMatch(/already active|already running/);
    });
  });

  // Feature 5: Quick Controls
  describe('F5: Quick Controls Tuning', () => {
    it('F5.1: 4K UHD resolution preset formats 3840x2160', () => {
      const args = buildScrcpyArgs({
        serial: 'test',
        profile: 'samsung_dex',
        resolution: '4k',
        dpi: 320,
        refreshRate: 60,
        codec: 'h264',
        audioRouting: true,
        modelName: 'test',
      });
      expect(args).toContain('--new-display=3840x2160/320');
    });

    it('F5.2: Retina 16:10 resolution preset formats 2560x1600', () => {
      const args = buildScrcpyArgs({
        serial: 'test',
        profile: 'samsung_dex',
        resolution: 'retina_16_10',
        dpi: 220,
        refreshRate: 60,
        codec: 'h264',
        audioRouting: true,
        modelName: 'test',
      });
      expect(args).toContain('--new-display=2560x1600/220');
    });

    it('F5.3: 120 FPS high refresh rate parameter is applied', () => {
      const args = buildScrcpyArgs({
        serial: 'test',
        profile: 'samsung_dex',
        resolution: '1080p',
        dpi: 200,
        refreshRate: 120,
        codec: 'h264',
        audioRouting: true,
        modelName: 'test',
      });
      expect(args).toContain('--max-fps=120');
    });

    it('F5.4: H.265 HEVC codec parameter is applied', () => {
      const args = buildScrcpyArgs({
        serial: 'test',
        profile: 'samsung_dex',
        resolution: '1080p',
        dpi: 200,
        refreshRate: 60,
        codec: 'h265',
        audioRouting: true,
        modelName: 'test',
      });
      expect(args).toContain('--video-codec=h265');
    });

    it('F5.5: Audio muting cleanly adds --no-audio flag', () => {
      const args = buildScrcpyArgs({
        serial: 'test',
        profile: 'samsung_dex',
        resolution: '1080p',
        dpi: 200,
        refreshRate: 60,
        codec: 'h264',
        audioRouting: false,
        modelName: 'test',
      });
      expect(args).toContain('--no-audio');
      expect(args.some((a) => a.startsWith('--audio-source'))).toBe(false);
    });
  });

  // Feature 6: Wireless Wizard
  describe('F6: Wireless Migration & Android 11+ Pairing', () => {
    it('F6.1: Discovers phone Wi-Fi IP and executes tcpip 5555 migration', async () => {
      adb.setMockDevice(MOCK_SAMSUNG_S24);
      await devManager.refreshDevices();

      const result = await wizard.migrateToWifi('R5CW10ABCDE');
      expect(result.success).toBe(true);
      expect(result.ip).toBe('192.168.1.101');
    });

    it('F6.2: Android 11+ pairDevice executes adb pair then connects', async () => {
      adb.simulateDeviceConnect({
        ...MOCK_SAMSUNG_S24,
        raw: { serial: 'R5CW10PAIR110', state: 'device' },
        ipAddress: '192.168.1.110',
      });
      const result = await wizard.pairDevice('192.168.1.110', 38412, '654321', 5555);
      expect(result.success).toBe(true);

      const recent = store.getRecentDevices();
      expect(recent.some((d) => d.ip === '192.168.1.110')).toBe(true);
    });

    it('F6.3: Wireless connect connects and adds device to recent store', async () => {
      adb.simulateDeviceConnect({
        ...MOCK_GENERIC_ANDROID,
        raw: { serial: '192.168.1.120:5555', state: 'device' },
        ipAddress: '192.168.1.120',
      });
      const result = await wizard.connectWireless('192.168.1.120', 5555);
      expect(result.success).toBe(true);

      const recent = store.getRecentDevices();
      expect(recent.some((d) => d.ip === '192.168.1.120')).toBe(true);
    });

    it('F6.4: Wireless disconnect removes device from connected list', async () => {
      adb.simulateDeviceConnect({
        ...MOCK_GENERIC_ANDROID,
        raw: { serial: '192.168.1.120:5555', state: 'device' },
        ipAddress: '192.168.1.120',
      });
      await wizard.connectWireless('192.168.1.120', 5555);
      const res = await wizard.disconnectWireless('192.168.1.120', 5555);
      expect(res.success).toBe(true);
    });

    it('F6.5: Reject invalid pairing PIN formats before calling ADB', async () => {
      const result = await wizard.pairDevice('192.168.1.110', 38412, '1234', 5555);
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/6 numeric digits|6 digits/);
    });
  });

  // Feature 7: Session Supervision
  describe('F7: Session Supervision & Process Teardown', () => {
    it('F7.1: Emits sessionStatusChanged event on launch', async () => {
      let statusEventReceived = false;
      launcher.on('sessionStatusChanged', (sess) => {
        if (sess.status === 'running') statusEventReceived = true;
      });

      await launcher.launchSession({
        serial: 'R5CW10ABCDE',
        profile: 'samsung_dex',
        resolution: '1440p',
        dpi: 240,
        refreshRate: 60,
        codec: 'h264',
        audioRouting: true,
        modelName: 'Galaxy S24 Ultra',
      });

      expect(statusEventReceived).toBe(true);
    });

    it('F7.2: Stop session terminates the running process and cleans up active sessions', async () => {
      const res = await launcher.launchSession({
        serial: 'R5CW10ABCDE',
        profile: 'samsung_dex',
        resolution: '1440p',
        dpi: 240,
        refreshRate: 60,
        codec: 'h264',
        audioRouting: true,
        modelName: 'Galaxy S24 Ultra',
      });

      expect(launcher.getActiveSessions().length).toBe(1);
      const stopRes = await launcher.stopSession(res.sessionId!);
      expect(stopRes.success).toBe(true);
      expect(launcher.getActiveSessions().length).toBe(0);
    });

    it('F7.3: Streams session log lines via sessionLog event', async () => {
      const logs: string[] = [];
      launcher.on('sessionLog', (entry) => {
        logs.push(entry.text);
      });

      const res = await launcher.launchSession({
        serial: 'R5CW10ABCDE',
        profile: 'samsung_dex',
        resolution: '1440p',
        dpi: 240,
        refreshRate: 60,
        codec: 'h264',
        audioRouting: true,
        modelName: 'Galaxy S24 Ultra',
      });

      // Retrieve mock process and emit stdout
      const proc = scrcpy.getSpawnedProcesses().find((p) => p.pid === launcher.getActiveSession(res.sessionId!)?.pid);
      proc?.emitStdout('[scrcpy] Connected to virtual display 1\n');

      expect(logs.some((l) => l.includes('virtual display 1'))).toBe(true);
    });

    it('F7.4: Automatically removes session when scrcpy exits', async () => {
      const res = await launcher.launchSession({
        serial: 'R5CW10ABCDE',
        profile: 'samsung_dex',
        resolution: '1440p',
        dpi: 240,
        refreshRate: 60,
        codec: 'h264',
        audioRouting: true,
        modelName: 'Galaxy S24 Ultra',
      });

      const session = launcher.getActiveSession(res.sessionId!);
      const proc = scrcpy.getSpawnedProcesses().find((p) => p.pid === session?.pid);
      proc?.emitExit(0);

      expect(launcher.getActiveSessions().length).toBe(0);
    });

    it('F7.5: stopAllSessions cleans up multiple sessions across devices', async () => {
      await launcher.launchSession({
        serial: 'DEV1',
        profile: 'samsung_dex',
        resolution: '1080p',
        dpi: 200,
        refreshRate: 60,
        codec: 'h264',
        audioRouting: true,
        modelName: 'Dev 1',
      });

      await launcher.launchSession({
        serial: 'DEV2',
        profile: 'universal_desktop',
        resolution: '1080p',
        dpi: 200,
        refreshRate: 60,
        codec: 'h264',
        audioRouting: true,
        modelName: 'Dev 2',
      });

      expect(launcher.getActiveSessions().length).toBe(2);
      await launcher.stopAllSessions();
      expect(launcher.getActiveSessions().length).toBe(0);
    });
  });
});
