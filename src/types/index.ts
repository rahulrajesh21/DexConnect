/**
 * DexConnect Domain Type Contracts
 * Universal types shared across Main process, Preload script, and Renderer UI.
 */

// --- Device Models ---

export interface BatteryInfo {
  level: number;
  scale: number;
  status: number;
  isCharging: boolean;
  powerSource: 'ac' | 'usb' | 'wireless' | 'battery';
}

export interface DeviceRawRecord {
  serial: string;
  state: 'device' | 'unauthorized' | 'offline' | 'unknown';
  product?: string;
  model?: string;
  device?: string;
  transportId?: string;
}

export type DeviceState = 'device' | 'unauthorized' | 'offline';
export type DeviceBrand = 'samsung' | 'motorola' | 'generic';
export type ConnectionType = 'usb' | 'wifi';

export interface DeviceInfo {
  serial: string;
  state: DeviceState;
  brand: DeviceBrand;
  manufacturer: string;
  model: string;
  androidVersion: string;
  connectionType: ConnectionType;
  ipAddress?: string;
  port?: number;
  battery: BatteryInfo;
}

// --- Session & Launch Configuration ---

export type LaunchProfile =
  | 'samsung_dex'
  | 'motorola_ready_for'
  | 'universal_desktop'
  | 'screen_mirror';

export type ResolutionPreset = '1080p' | '1440p' | '4k' | 'retina_16_10';
export type VideoCodec = 'h264' | 'h265';
export type RefreshRate = 60 | 90 | 120;

export interface LaunchConfig {
  serial: string;
  profile: LaunchProfile;
  resolution: ResolutionPreset;
  dpi: number; // 160-320
  refreshRate: RefreshRate;
  codec: VideoCodec;
  audioRouting: boolean;
  modelName: string;
}

export type SessionStatus = 'starting' | 'running' | 'stopping' | 'terminated' | 'error';

export interface ActiveSession {
  sessionId: string;
  deviceSerial: string;
  profile: LaunchProfile;
  pid: number;
  startedAt: string;
  config: LaunchConfig;
  status: SessionStatus;
  exitCode?: number;
  error?: string;
}

export interface SessionLogEntry {
  sessionId: string;
  text: string;
}

// --- Wireless & System Status ---

export interface RecentWirelessDevice {
  ip: string;
  port: number;
  model: string;
  lastSeen: number;
}

export interface PairWirelessPayload {
  ip: string;
  pairingPort: number;
  code: string;
  connectPort: number;
}

export interface SystemStatus {
  adb: boolean;
  scrcpy: boolean;
  scrcpyVersion?: string;
}

// --- Operation Results ---

export interface LaunchSessionResult {
  success: boolean;
  sessionId?: string;
  error?: string;
}

export interface OperationResult {
  success: boolean;
  error?: string;
}

export interface MigrateWirelessResult {
  success: boolean;
  ip?: string;
  error?: string;
}

// --- QR Code Pairing ---

export interface QrPairingSession {
  sessionId: string;
  serviceName: string;
  password: string;
  qrPayload: string;
  qrDataUrl: string;
  expiresAt: number;
}

export type QrPairingState =
  | 'idle'
  | 'waiting_for_scan'
  | 'device_spotted'
  | 'pairing'
  | 'connecting'
  | 'completed'
  | 'error'
  | 'cancelled'
  | 'timeout';

export interface QrPairingProgress {
  sessionId: string;
  state: QrPairingState;
  serviceName: string;
  ip?: string;
  pairingPort?: number;
  connectPort?: number;
  error?: string;
  device?: RecentWirelessDevice;
}

// --- Preload Bridge Interface ---

export interface IDexConnectAPI {
  // Queries
  getDevices: () => Promise<DeviceInfo[]>;
  getSystemStatus: () => Promise<SystemStatus>;
  getActiveSessions: () => Promise<ActiveSession[]>;
  getRecentWirelessDevices: () => Promise<RecentWirelessDevice[]>;

  // Commands
  launchSession: (config: LaunchConfig) => Promise<LaunchSessionResult>;
  stopSession: (sessionId: string) => Promise<OperationResult>;
  migrateToWireless: (serial: string) => Promise<MigrateWirelessResult>;
  pairWirelessDevice: (payload: PairWirelessPayload) => Promise<OperationResult>;
  connectWirelessDevice: (address: string) => Promise<OperationResult>;
  startQrPairing?: (options?: any) => Promise<QrPairingSession>;
  stopQrPairing?: (sessionId?: string) => Promise<OperationResult>;

  // Subscriptions with Cleanup Callbacks
  onDevicesUpdated: (callback: (devices: DeviceInfo[]) => void) => () => void;
  onSessionStatusChanged: (callback: (session: ActiveSession) => void) => () => void;
  onSessionLog: (callback: (log: SessionLogEntry) => void) => () => void;
  onQrPairingProgress?: (callback: (progress: QrPairingProgress) => void) => () => void;
}
