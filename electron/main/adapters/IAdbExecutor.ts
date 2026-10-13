/**
 * Raw record returned from `adb devices -l`
 */
export interface DeviceRawRecord {
  serial: string;
  state: 'device' | 'unauthorized' | 'offline' | 'unknown';
  product?: string;
  model?: string;
  device?: string;
  transportId?: string;
}

/**
 * Parsed battery information from `dumpsys battery`
 */
export interface BatteryInfo {
  level: number;       // 0-100 percentage
  scale: number;       // typically 100
  status: number;      // 1=unknown, 2=charging, 3=discharging, 4=not charging, 5=full
  isCharging: boolean;
  powerSource: 'ac' | 'usb' | 'wireless' | 'battery';
}

/**
 * Generic ADB execution command result
 */
export interface AdbCommandResult {
  success: boolean;
  output: string;
  error?: string;
}

/**
 * Information regarding ADB binary installation
 */
export interface AdbInstallationInfo {
  installed: boolean;
  path: string;
  version?: string;
  error?: string;
}

/**
 * Interface contract for ADB process interactions
 */
export interface IAdbExecutor {
  /**
   * Queries attached devices via `adb devices -l`
   */
  getDevices(): Promise<DeviceRawRecord[]>;

  /**
   * Queries an Android system property via `adb shell getprop <prop>`
   */
  getProp(serial: string, prop: string): Promise<string>;

  /**
   * Queries battery state via `adb shell dumpsys battery`
   */
  getBatteryInfo(serial: string): Promise<BatteryInfo>;

  /**
   * Queries Wi-Fi IP address of the device
   */
  getDeviceIp(serial: string): Promise<string | null>;

  /**
   * Restarts ADB daemon on target device in TCP mode on the given port
   */
  switchTcpip(serial: string, port: number): Promise<AdbCommandResult>;

  /**
   * Connects to a device via TCP/IP address (<ip>:<port>)
   */
  connect(address: string): Promise<AdbCommandResult>;

  /**
   * Disconnects a wireless device (or all wireless devices if address omitted)
   */
  disconnect(address?: string): Promise<AdbCommandResult>;

  /**
   * Pairs with an Android 11+ device using wireless debugging
   */
  pair(addressWithPort: string, code: string): Promise<AdbCommandResult>;

  /**
   * Checks whether ADB is installed and returns version and binary path
   */
  checkAdbInstalled(): Promise<AdbInstallationInfo>;

  /**
   * Executes a raw ADB command with arguments (optional utility)
   */
  executeRaw?(args: string[]): Promise<AdbCommandResult>;
}
