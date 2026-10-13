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
  private adbInstalled = true;
  private adbPath = '/opt/homebrew/bin/adb';
  private adbVersion = '1.0.41 (Mock)';

  constructor(initialDevices?: MockDeviceState[]) {
    this.reset(initialDevices);
  }

  /**
   * Resets the mock state to initial fixtures
   */
  public reset(initialDevices = DEFAULT_MOCK_DEVICES): void {
    this.devices.clear();
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
    return Array.from(this.devices.values()).map((d) => ({ ...d.raw }));
  }

  public async getProp(serial: string, prop: string): Promise<string> {
    const dev = this.devices.get(serial);
    if (!dev) return '';
    return dev.props[prop] || '';
  }

  public async getBatteryInfo(serial: string): Promise<BatteryInfo> {
    const dev = this.devices.get(serial);
    if (!dev) {
      throw new Error(`Device '${serial}' not found`);
    }
    return { ...dev.battery };
  }

  public async getDeviceIp(serial: string): Promise<string | null> {
    const dev = this.devices.get(serial);
    if (!dev) return null;
    return dev.ipAddress;
  }

  public async switchTcpip(serial: string, port: number): Promise<AdbCommandResult> {
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

    if (matchingDevice) {
      const newWifiSerial = targetAddress;
      const wifiDevice: MockDeviceState = {
        raw: {
          serial: newWifiSerial,
          state: 'device',
          product: matchingDevice.raw.product,
          model: matchingDevice.raw.model,
          device: matchingDevice.raw.device,
          transportId: (this.devices.size + 1).toString(),
        },
        props: { ...matchingDevice.props },
        battery: { ...matchingDevice.battery, powerSource: 'battery', isCharging: false },
        ipAddress: matchingDevice.ipAddress,
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
      if (this.devices.has(address)) {
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
    // 6-digit numeric validation rule
    if (!/^\d{6}$/.test(code) || code === '000000') {
      return {
        success: false,
        output: 'Failed: Wrong password or connection closed.',
      };
    }
    return {
      success: true,
      output: `Successfully paired to ${addressWithPort} [guid: mock-pairing-guid-${Date.now()}]`,
    };
  }

  public async executeRaw(args: string[]): Promise<AdbCommandResult> {
    return { success: true, output: `mock executed: adb ${args.join(' ')}` };
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
}
