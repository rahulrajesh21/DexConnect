import type {
  IAdbExecutor,
  DeviceRawRecord,
  BatteryInfo,
  AdbCommandResult,
  AdbInstallationInfo,
} from './IAdbExecutor';

export interface MockDeviceState {
  raw: DeviceRawRecord;
  props: Record<string, string>;
  battery: BatteryInfo;
  ipAddress: string | null;
  tcpipPort: number | null;
}

/**
 * Standard test fixtures representing realistic devices
 */
export const DEFAULT_MOCK_DEVICES: MockDeviceState[] = [
  {
    raw: {
      serial: 'R5CW10ABCDE',
      state: 'device',
      product: 'e3q',
      model: 'SM-S928B',
      device: 'e3q',
      transportId: '1',
    },
    props: {
      'ro.product.manufacturer': 'samsung',
      'ro.product.model': 'SM-S928B',
      'ro.build.version.release': '14',
    },
    battery: {
      level: 85,
      scale: 100,
      status: 2,
      isCharging: true,
      powerSource: 'usb',
    },
    ipAddress: '192.168.1.101',
    tcpipPort: null,
  },
  {
    raw: {
      serial: 'ZY22ABCD12',
      state: 'device',
      product: 'eqs',
      model: 'XT2401-2',
      device: 'eqs',
      transportId: '2',
    },
    props: {
      'ro.product.manufacturer': 'motorola',
      'ro.product.model': 'motorola edge 50 ultra',
      'ro.build.version.release': '14',
    },
    battery: {
      level: 62,
      scale: 100,
      status: 3,
      isCharging: false,
      powerSource: 'battery',
    },
    ipAddress: '192.168.1.102',
    tcpipPort: null,
  },
  {
    raw: {
      serial: '192.168.1.103:5555',
      state: 'device',
      product: 'husky',
      model: 'Pixel_8_Pro',
      device: 'husky',
      transportId: '3',
    },
    props: {
      'ro.product.manufacturer': 'Google',
      'ro.product.model': 'Pixel 8 Pro',
      'ro.build.version.release': '15',
    },
    battery: {
      level: 94,
      scale: 100,
      status: 2,
      isCharging: true,
      powerSource: 'ac',
    },
    ipAddress: '192.168.1.103',
    tcpipPort: 5555,
  },
];

export class MockAdbExecutor implements IAdbExecutor {
  private devices: Map<string, MockDeviceState> = new Map();
  private pairedIps: Set<string> = new Set();
  private adbInstalled = true;
  private adbPath = '/opt/homebrew/bin/adb';
  private adbVersion = '1.0.41 (Mock)';
  public commandHistory: string[] = [];
  public simulateConnectFailure = false;
  public simulateDaemonStartBanner = false;
  public simulateCorruptedBattery = false;
  public simulateCorruptedGetprop = false;
  private customMdnsOutput: string | null = null;
  private mdnsDevices: Map<string, { pairPort: number; connectPort: number; serviceName: string }> = new Map();

  constructor(initialDevices?: MockDeviceState[]) {
    this.reset(initialDevices);
  }

  /**
   * Resets the mock state to initial fixtures
   */
  public reset(initialDevices = DEFAULT_MOCK_DEVICES): void {
    this.devices.clear();
    this.pairedIps.clear();
    this.mdnsDevices.clear();
    this.customMdnsOutput = null;
    this.commandHistory = [];
    this.simulateConnectFailure = false;
    this.simulateDaemonStartBanner = false;
    this.simulateCorruptedBattery = false;
    this.simulateCorruptedGetprop = false;
    for (const d of initialDevices) {
      this.devices.set(d.raw.serial, JSON.parse(JSON.stringify(d)));
    }
  }

  public async checkAdbInstalled(): Promise<AdbInstallationInfo> {
    if (!this.adbInstalled) {
      return { installed: false, path: this.adbPath, error: 'ADB binary not found' };
    }
    return {
      installed: true,
      path: this.adbPath,
      version: this.adbVersion,
    };
  }

  public async getDevices(): Promise<DeviceRawRecord[]> {
    this.commandHistory.push('adb devices -l');
    return Array.from(this.devices.values()).map((d) => ({ ...d.raw }));
  }

  public async getProp(serial: string, prop: string): Promise<string> {
    this.commandHistory.push(`adb -s ${serial} shell getprop ${prop}`);
    if (this.simulateCorruptedGetprop) return 'null\x00corrupt';
    const dev = this.devices.get(serial);
    if (!dev) return '';
    return dev.props[prop] || '';
  }

  public async getBatteryInfo(serial: string): Promise<BatteryInfo> {
    this.commandHistory.push(`adb -s ${serial} shell dumpsys battery`);
    if (this.simulateCorruptedBattery) {
      return { level: 50, scale: 100, status: 2, isCharging: false, powerSource: 'battery' };
    }
    const dev = this.devices.get(serial);
    if (!dev) {
      throw new Error(`Device '${serial}' not found`);
    }
    return { ...dev.battery };
  }

  public async getDeviceIp(serial: string): Promise<string | null> {
    this.commandHistory.push(`adb -s ${serial} shell ip route`);
    const dev = this.devices.get(serial);
    if (!dev) return null;
    return dev.ipAddress;
  }

  public async switchTcpip(serial: string, port: number): Promise<AdbCommandResult> {
    this.commandHistory.push(`adb -s ${serial} tcpip ${port}`);
    const dev = this.devices.get(serial);
    if (!dev) {
      return { success: false, output: `error: device '${serial}' not found` };
    }
    dev.tcpipPort = port;
    return {
      success: true,
      output: `restarting in TCP mode port: ${port}`,
    };
  }

  public async connect(address: string): Promise<AdbCommandResult> {
    this.commandHistory.push(`adb connect ${address}`);
    if (this.simulateConnectFailure) {
      return { success: false, output: `failed to connect to ${address}: Connection refused` };
    }
    const targetAddress = address.includes(':') ? address : `${address}:5555`;
    const targetIp = targetAddress.split(':')[0];

    // Check if already connected
    if (this.devices.has(targetAddress)) {
      return { success: true, output: `already connected to ${targetAddress}` };
    }

    // Find if a USB device matches this IP
    const matchingDevice = Array.from(this.devices.values()).find(
      (d) => d.ipAddress === targetIp
    );

    if (matchingDevice || this.mdnsDevices.has(targetIp)) {
      const newWifiSerial = targetAddress;
      const wifiDevice: MockDeviceState = {
        raw: {
          serial: newWifiSerial,
          state: 'device',
          product: matchingDevice?.raw.product || 'paired-device',
          model: matchingDevice?.raw.model || 'Wireless Device',
          device: matchingDevice?.raw.device || 'paired-device',
          transportId: (this.devices.size + 1).toString(),
        },
        props: matchingDevice
          ? { ...matchingDevice.props }
          : {
              'ro.product.manufacturer': 'generic',
              'ro.product.model': 'Wireless Device',
              'ro.build.version.release': '14',
            },
        battery: matchingDevice
          ? { ...matchingDevice.battery, powerSource: 'battery', isCharging: false }
          : { level: 85, scale: 100, status: 2, isCharging: false, powerSource: 'battery' },
        ipAddress: targetIp,
        tcpipPort: 5555,
      };
      this.devices.set(newWifiSerial, wifiDevice);
      return { success: true, output: `connected to ${targetAddress}` };
    }

    return {
      success: false,
      output: `failed to connect to ${targetAddress}: Connection refused`,
    };
  }

  public async disconnect(address?: string): Promise<AdbCommandResult> {
    if (address) {
      const target = address.includes(':') ? address : `${address}:5555`;
      if (this.devices.has(target) || this.devices.has(address)) {
        this.devices.delete(target);
        this.devices.delete(address);
        return { success: true, output: `disconnected ${address}` };
      }
      return { success: false, output: `error: no such device '${address}'` };
    }

    // Disconnect all wireless devices (serials containing ':')
    for (const [serial] of this.devices) {
      if (serial.includes(':')) {
        this.devices.delete(serial);
      }
    }
    return { success: true, output: 'disconnected everything' };
  }

  public async pair(addressWithPort: string, code: string): Promise<AdbCommandResult> {
    const is6DigitPin = /^\d{6}$/.test(code) && code !== '000000';
    const isQrPassword = typeof code === 'string' && /^[A-Za-z0-9]{16,}$/.test(code) && code !== 'FAIL_PASSWORD';
    if (!is6DigitPin && !isQrPassword) {
      return {
        success: false,
        output: 'Failed: Wrong password or connection closed.',
      };
    }
    const ip = addressWithPort.split(':')[0];
    this.pairedIps.add(ip);
    return {
      success: true,
      output: `Successfully paired to ${addressWithPort} [guid: mock-pairing-guid-${Date.now()}]`,
    };
  }

  public getMdnsServicesString(): string {
    if (this.customMdnsOutput !== null) {
      return this.customMdnsOutput;
    }
    const lines: string[] = ['List of discovered mdns services'];
    for (const [ip, info] of this.mdnsDevices.entries()) {
      if (info.pairPort) {
        lines.push(`${info.serviceName}._adb-tls-pairing._tcp.    _adb-tls-pairing._tcp.    ${ip}:${info.pairPort}`);
      }
      if (info.connectPort) {
        lines.push(`${info.serviceName}._adb-tls-connect._tcp.    _adb-tls-connect._tcp.    ${ip}:${info.connectPort}`);
      }
    }
    return lines.join('\n');
  }

  public async getMdnsServices(): Promise<AdbCommandResult> {
    return {
      success: true,
      output: this.getMdnsServicesString(),
    };
  }

  public async executeRaw(args: string[]): Promise<AdbCommandResult> {
    if (args[0] === 'mdns' && args[1] === 'services') {
      return this.getMdnsServices();
    }
    return { success: true, output: `mock executed: adb ${args.join(' ')}` };
  }

  public setMdnsServicesOutput(output: string | null): void {
    this.customMdnsOutput = output;
  }

  public simulateMdnsPairingDevice(
    ip: string,
    pairPort: number,
    connectPort = 5555,
    serviceName = 'adb-mock-device'
  ): void {
    this.mdnsDevices.set(ip, { pairPort, connectPort, serviceName });
  }

  public simulateMdnsRemove(ip: string): void {
    this.mdnsDevices.delete(ip);
  }

  // --- Test & Dynamic Simulation Hooks ---

  public simulateDeviceConnect(device: MockDeviceState): void {
    this.devices.set(device.raw.serial, JSON.parse(JSON.stringify(device)));
  }

  public simulateDeviceDisconnect(serial: string): void {
    this.devices.delete(serial);
  }

  public simulateDeviceState(serial: string, state: DeviceRawRecord['state']): void {
    const dev = this.devices.get(serial);
    if (dev) dev.raw.state = state;
  }

  public simulateBatteryUpdate(serial: string, update: Partial<BatteryInfo>): void {
    const dev = this.devices.get(serial);
    if (dev) {
      dev.battery = { ...dev.battery, ...update };
    }
  }

  public simulateAdbInstalled(installed: boolean): void {
    this.adbInstalled = installed;
  }

  public setMockDevice(device: MockDeviceState): void {
    this.simulateDeviceConnect(device);
  }

  public removeMockDevice(serial: string): void {
    this.simulateDeviceDisconnect(serial);
  }

  public getCommandHistory(): string[] {
    return [...this.commandHistory];
  }

  public async raw(args: string[]): Promise<any> {
    this.commandHistory.push(`adb ${args.join(' ')}`);
    const output = `mock raw: adb ${args.join(' ')} Android Debug Bridge version 1.0.41`;
    return {
      exitCode: 0,
      stdout: output,
      stderr: '',
      success: true,
      output,
    };
  }
}
