import type { MockDeviceState } from '../../electron/main/adapters/MockAdbExecutor';

export const MOCK_SAMSUNG_S24: MockDeviceState = {
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
};

export const MOCK_MOTOROLA_EDGE: MockDeviceState = {
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
};

export const MOCK_GENERIC_ANDROID: MockDeviceState = {
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
};

export const DEFAULT_MOCK_DEVICES: MockDeviceState[] = [
  MOCK_SAMSUNG_S24,
  MOCK_MOTOROLA_EDGE,
  MOCK_GENERIC_ANDROID,
];
