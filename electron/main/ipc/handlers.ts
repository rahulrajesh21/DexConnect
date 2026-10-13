import { ipcMain } from 'electron';
import { DEXCONNECT_CHANNELS } from './channels';
import type { IAdbExecutor } from '../adapters/IAdbExecutor';
import type { IScrcpyProcessRunner } from '../adapters/IScrcpyProcessRunner';
import type { DeviceManager } from '../services/DeviceManager';
import type { SessionLauncher } from '../services/SessionLauncher';
import type {
  DeviceInfo,
  LaunchConfig,
  LaunchSessionResult,
  OperationResult,
  ActiveSession,
  MigrateWirelessResult,
  PairWirelessPayload,
  RecentWirelessDevice,
  SystemStatus,
  BatteryInfo,
} from '../../../src/types';

export interface HandlerContext {
  adb?: IAdbExecutor;
  scrcpy?: IScrcpyProcessRunner;
  adbExecutor?: IAdbExecutor;
  scrcpyRunner?: IScrcpyProcessRunner;
  deviceManager?: DeviceManager;
  sessionLauncher?: SessionLauncher;
}

export function registerIpcHandlers(context: HandlerContext): void {
  const adb = context.adbExecutor || context.adb;
  const scrcpy = context.scrcpyRunner || context.scrcpy;
  const deviceManager = context.deviceManager;
  const sessionLauncher = context.sessionLauncher;

  if (!adb || !scrcpy) {
    throw new Error('registerIpcHandlers requires both adb and scrcpy adapters');
  }

  // Clear any existing handlers to prevent duplicate handler collisions during reloads/tests
  const channels = [
    DEXCONNECT_CHANNELS.GET_DEVICES,
    DEXCONNECT_CHANNELS.GET_SYSTEM_STATUS,
    DEXCONNECT_CHANNELS.LAUNCH_SESSION,
    DEXCONNECT_CHANNELS.STOP_SESSION,
    DEXCONNECT_CHANNELS.GET_ACTIVE_SESSIONS,
    DEXCONNECT_CHANNELS.MIGRATE_WIRELESS,
    DEXCONNECT_CHANNELS.PAIR_WIRELESS_DEVICE,
    DEXCONNECT_CHANNELS.CONNECT_WIRELESS_DEVICE,
    DEXCONNECT_CHANNELS.GET_RECENT_WIRELESS_DEVICES,
  ];

  for (const channel of channels) {
    ipcMain.removeHandler(channel);
  }

  // 1. GET_DEVICES
  ipcMain.handle(DEXCONNECT_CHANNELS.GET_DEVICES, async (): Promise<DeviceInfo[]> => {
    if (deviceManager) {
      const cached = deviceManager.getDevices();
      if (cached.length > 0) {
        return cached;
      }
      return await deviceManager.refresh();
    }
    try {
      const records = await adb.getDevices();
      const devices: DeviceInfo[] = await Promise.all(
        records.map(async (r) => {
          let manufacturer = 'generic';
          let model = r.model || r.serial;
          let androidVersion = '14';
          let battery: BatteryInfo = {
            level: 100,
            scale: 100,
            status: 2,
            isCharging: true,
            powerSource: r.serial.includes(':') ? 'battery' : 'usb',
          };

          if (r.state === 'device') {
            try {
              const mfg = await adb.getProp(r.serial, 'ro.product.manufacturer');
              if (mfg) manufacturer = mfg.toLowerCase();
              const mdl = await adb.getProp(r.serial, 'ro.product.model');
              if (mdl) model = mdl;
              const ver = await adb.getProp(r.serial, 'ro.build.version.release');
              if (ver) androidVersion = ver;
              const batt = await adb.getBatteryInfo(r.serial);
              if (batt) battery = batt;
            } catch {
              // Ignore property extraction errors for degraded devices
            }
          }

          let brand: 'samsung' | 'motorola' | 'generic' = 'generic';
          if (manufacturer.includes('samsung')) brand = 'samsung';
          else if (manufacturer.includes('motorola')) brand = 'motorola';

          return {
            serial: r.serial,
            state: r.state === 'device' ? 'device' : r.state === 'offline' ? 'offline' : 'unauthorized',
            brand,
            manufacturer,
            model,
            androidVersion,
            connectionType: r.serial.includes(':') ? 'wifi' : 'usb',
            battery,
          };
        })
      );
      return devices;
    } catch (err: any) {
      console.error('[IPC] Failed to fetch devices:', err);
      return [];
    }
  });

  // 2. GET_SYSTEM_STATUS
  ipcMain.handle(DEXCONNECT_CHANNELS.GET_SYSTEM_STATUS, async (): Promise<SystemStatus> => {
    const adbInfo = await adb.checkAdbInstalled();
    const scrcpyInfo = await scrcpy.checkScrcpyInstalled();
    return {
      adb: adbInfo.installed,
      scrcpy: scrcpyInfo.installed,
      scrcpyVersion: scrcpyInfo.version,
    };
  });

  // 3. LAUNCH_SESSION
  ipcMain.handle(
    DEXCONNECT_CHANNELS.LAUNCH_SESSION,
    async (_event, config: LaunchConfig): Promise<LaunchSessionResult> => {
      if (!sessionLauncher) {
        return { success: false, error: 'SessionLauncher is not initialized' };
      }
      try {
        return await sessionLauncher.launchSession(config);
      } catch (err: any) {
        return { success: false, error: err?.message || String(err) };
      }
    }
  );

  // 4. STOP_SESSION
  ipcMain.handle(
    DEXCONNECT_CHANNELS.STOP_SESSION,
    async (_event, sessionId: string): Promise<OperationResult> => {
      if (!sessionLauncher) {
        return { success: false, error: 'SessionLauncher is not initialized' };
      }
      try {
        return await sessionLauncher.stopSession(sessionId);
      } catch (err: any) {
        return { success: false, error: err?.message || String(err) };
      }
    }
  );

  // 5. GET_ACTIVE_SESSIONS
  ipcMain.handle(
    DEXCONNECT_CHANNELS.GET_ACTIVE_SESSIONS,
    async (): Promise<ActiveSession[]> => {
      if (!sessionLauncher) {
        return [];
      }
      return sessionLauncher.getActiveSessions();
    }
  );

  // 6. MIGRATE_WIRELESS
  ipcMain.handle(
    DEXCONNECT_CHANNELS.MIGRATE_WIRELESS,
    async (_event, serial: string): Promise<MigrateWirelessResult> => {
      const ip = await adb.getDeviceIp(serial);
      if (!ip) {
        return { success: false, error: 'Failed to detect device IP address' };
      }
      const tcpipRes = await adb.switchTcpip(serial, 5555);
      if (!tcpipRes.success) {
        return { success: false, error: tcpipRes.output };
      }
      const connRes = await adb.connect(`${ip}:5555`);
      return {
        success: connRes.success,
        ip,
        error: connRes.success ? undefined : connRes.output,
      };
    }
  );

  // 7. PAIR_WIRELESS_DEVICE
  ipcMain.handle(
    DEXCONNECT_CHANNELS.PAIR_WIRELESS_DEVICE,
    async (_event, payload: PairWirelessPayload): Promise<OperationResult> => {
      const pairRes = await adb.pair(`${payload.ip}:${payload.pairingPort}`, payload.code);
      if (!pairRes.success) {
        return { success: false, error: pairRes.output };
      }
      const connRes = await adb.connect(`${payload.ip}:${payload.connectPort}`);
      return {
        success: connRes.success,
        error: connRes.success ? undefined : connRes.output,
      };
    }
  );

  // 8. CONNECT_WIRELESS_DEVICE
  ipcMain.handle(
    DEXCONNECT_CHANNELS.CONNECT_WIRELESS_DEVICE,
    async (_event, address: string): Promise<OperationResult> => {
      const connRes = await adb.connect(address);
      return {
        success: connRes.success,
        error: connRes.success ? undefined : connRes.output,
      };
    }
  );

  // 9. GET_RECENT_WIRELESS_DEVICES
  ipcMain.handle(DEXCONNECT_CHANNELS.GET_RECENT_WIRELESS_DEVICES, async (): Promise<RecentWirelessDevice[]> => {
    return [];
  });
}
