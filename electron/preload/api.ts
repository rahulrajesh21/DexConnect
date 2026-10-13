import { ipcRenderer, IpcRendererEvent } from 'electron';
import { DEXCONNECT_CHANNELS } from '../main/ipc/channels';
import type {
  DeviceInfo,
  SystemStatus,
  LaunchConfig,
  LaunchSessionResult,
  OperationResult,
  ActiveSession,
  MigrateWirelessResult,
  PairWirelessPayload,
  RecentWirelessDevice,
  SessionLogEntry,
  IDexConnectAPI,
} from '../../src/types';

export const dexconnectAPI: IDexConnectAPI = {
  // Device Queries & Status
  getDevices: (): Promise<DeviceInfo[]> => {
    return ipcRenderer.invoke(DEXCONNECT_CHANNELS.GET_DEVICES);
  },

  getSystemStatus: (): Promise<SystemStatus> => {
    return ipcRenderer.invoke(DEXCONNECT_CHANNELS.GET_SYSTEM_STATUS);
  },

  // Session Controls
  launchSession: (config: LaunchConfig): Promise<LaunchSessionResult> => {
    return ipcRenderer.invoke(DEXCONNECT_CHANNELS.LAUNCH_SESSION, config);
  },

  stopSession: (sessionId: string): Promise<OperationResult> => {
    return ipcRenderer.invoke(DEXCONNECT_CHANNELS.STOP_SESSION, sessionId);
  },

  getActiveSessions: (): Promise<ActiveSession[]> => {
    return ipcRenderer.invoke(DEXCONNECT_CHANNELS.GET_ACTIVE_SESSIONS);
  },

  // Wireless Wizard
  migrateToWireless: (serial: string): Promise<MigrateWirelessResult> => {
    return ipcRenderer.invoke(DEXCONNECT_CHANNELS.MIGRATE_WIRELESS, serial);
  },

  pairWirelessDevice: (payload: PairWirelessPayload): Promise<OperationResult> => {
    return ipcRenderer.invoke(DEXCONNECT_CHANNELS.PAIR_WIRELESS_DEVICE, payload);
  },

  connectWirelessDevice: (address: string): Promise<OperationResult> => {
    return ipcRenderer.invoke(DEXCONNECT_CHANNELS.CONNECT_WIRELESS_DEVICE, address);
  },

  getRecentWirelessDevices: (): Promise<RecentWirelessDevice[]> => {
    return ipcRenderer.invoke(DEXCONNECT_CHANNELS.GET_RECENT_WIRELESS_DEVICES);
  },

  // Event Subscriptions with Teardown Handlers
  onDevicesUpdated: (callback: (devices: DeviceInfo[]) => void): (() => void) => {
    const handler = (_event: IpcRendererEvent, devices: DeviceInfo[]) => {
      callback(devices);
    };
    ipcRenderer.on(DEXCONNECT_CHANNELS.DEVICES_UPDATED, handler);
    return () => {
      ipcRenderer.removeListener(DEXCONNECT_CHANNELS.DEVICES_UPDATED, handler);
    };
  },

  onSessionStatusChanged: (callback: (session: ActiveSession) => void): (() => void) => {
    const handler = (_event: IpcRendererEvent, session: ActiveSession) => {
      callback(session);
    };
    ipcRenderer.on(DEXCONNECT_CHANNELS.SESSION_STATUS_CHANGED, handler);
    return () => {
      ipcRenderer.removeListener(DEXCONNECT_CHANNELS.SESSION_STATUS_CHANGED, handler);
    };
  },

  onSessionLog: (callback: (log: SessionLogEntry) => void): (() => void) => {
    const handler = (_event: IpcRendererEvent, log: SessionLogEntry) => {
      callback(log);
    };
    ipcRenderer.on(DEXCONNECT_CHANNELS.SESSION_LOG, handler);
    return () => {
      ipcRenderer.removeListener(DEXCONNECT_CHANNELS.SESSION_LOG, handler);
    };
  },
};

export default dexconnectAPI;
