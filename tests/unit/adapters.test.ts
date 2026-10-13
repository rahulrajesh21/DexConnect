import { describe, it, expect, beforeEach } from 'vitest';
import {
  SystemAdbExecutor,
  MockAdbExecutor,
  SystemScrcpyRunner,
  MockScrcpyRunner,
} from '../../electron/main/adapters';
import {
  getAdapters,
  isMockMode,
  setAdbExecutor,
  setScrcpyRunner,
  resetAdapters,
} from '../../electron/main/factory';
import { MOCK_SAMSUNG_S24 } from '../fixtures/mockDevices';

describe('SystemAdbExecutor', () => {
  it('cleanDaemonOutput removes daemon startup lines', () => {
    const executor = new SystemAdbExecutor();
    const raw = `* daemon not running; starting now at tcp:5037\n* daemon started successfully\nList of devices attached\nR5CW10ABCDE device product:e3q`;
    const cleaned = executor.cleanDaemonOutput(raw);
    expect(cleaned).not.toContain('* daemon');
    expect(cleaned).toContain('List of devices attached');
    expect(cleaned).toContain('R5CW10ABCDE device');
  });

  it('resolveAdbPath detects /opt/homebrew/bin/adb on macOS', () => {
    const executor = new SystemAdbExecutor();
    const resolved = executor.resolveAdbPath();
    expect(resolved).toBeTruthy();
    expect(resolved).toContain('adb');
  });

  it('checkAdbInstalled verifies host adb binary', async () => {
    const executor = new SystemAdbExecutor();
    const info = await executor.checkAdbInstalled();
    expect(info.installed).toBe(true);
    expect(info.version).toBeTruthy();
  });
});

describe('SystemScrcpyRunner', () => {
  it('resolveScrcpyPath detects /opt/homebrew/bin/scrcpy on macOS', () => {
    const runner = new SystemScrcpyRunner();
    const resolved = runner.resolveScrcpyPath();
    expect(resolved).toBeTruthy();
    expect(resolved).toContain('scrcpy');
  });

  it('checkScrcpyInstalled verifies scrcpy v5.0.1 on host', async () => {
    const runner = new SystemScrcpyRunner();
    const info = await runner.checkScrcpyInstalled();
    expect(info.installed).toBe(true);
    expect(info.version).toContain('5.0.1');
  });
});

describe('MockAdbExecutor', () => {
  let mockAdb: MockAdbExecutor;

  beforeEach(() => {
    mockAdb = new MockAdbExecutor();
  });

  it('getDevices returns initial fixtures', async () => {
    const devices = await mockAdb.getDevices();
    expect(devices.length).toBe(3);
    expect(devices.map((d) => d.serial)).toContain('R5CW10ABCDE');
    expect(devices.map((d) => d.serial)).toContain('ZY22ABCD12');
    expect(devices.map((d) => d.serial)).toContain('192.168.1.103:5555');
  });

  it('getProp returns expected Android properties', async () => {
    const mfgSamsung = await mockAdb.getProp('R5CW10ABCDE', 'ro.product.manufacturer');
    expect(mfgSamsung).toBe('samsung');

    const mfgMoto = await mockAdb.getProp('ZY22ABCD12', 'ro.product.manufacturer');
    expect(mfgMoto).toBe('motorola');

    const missing = await mockAdb.getProp('NON_EXISTENT', 'ro.product.manufacturer');
    expect(missing).toBe('');
  });

  it('getBatteryInfo returns parsed battery metrics', async () => {
    const battery = await mockAdb.getBatteryInfo('R5CW10ABCDE');
    expect(battery.level).toBe(85);
    expect(battery.isCharging).toBe(true);
    expect(battery.powerSource).toBe('usb');
  });

  it('getDeviceIp returns correct IP address', async () => {
    const ip = await mockAdb.getDeviceIp('R5CW10ABCDE');
    expect(ip).toBe('192.168.1.101');
  });

  it('switchTcpip switches device to TCP mode', async () => {
    const res = await mockAdb.switchTcpip('R5CW10ABCDE', 5555);
    expect(res.success).toBe(true);
    expect(res.output).toContain('restarting in TCP mode port: 5555');
  });

  it('connect establishes wireless device', async () => {
    const res = await mockAdb.connect('192.168.1.101:5555');
    expect(res.success).toBe(true);
    expect(res.output).toContain('connected to 192.168.1.101:5555');

    const devices = await mockAdb.getDevices();
    expect(devices.some((d) => d.serial === '192.168.1.101:5555')).toBe(true);
  });

  it('connect fails on unknown target IP', async () => {
    const res = await mockAdb.connect('192.168.1.250:5555');
    expect(res.success).toBe(false);
    expect(res.output).toContain('Connection refused');
  });

  it('disconnect disconnects wireless devices', async () => {
    await mockAdb.connect('192.168.1.101:5555');
    const res = await mockAdb.disconnect('192.168.1.101:5555');
    expect(res.success).toBe(true);

    const devices = await mockAdb.getDevices();
    expect(devices.some((d) => d.serial === '192.168.1.101:5555')).toBe(false);
  });

  it('pair validates 6-digit numeric codes', async () => {
    const valid = await mockAdb.pair('192.168.1.101:38192', '123456');
    expect(valid.success).toBe(true);
    expect(valid.output).toContain('Successfully paired');

    const invalidPin = await mockAdb.pair('192.168.1.101:38192', '000000');
    expect(invalidPin.success).toBe(false);

    const invalidLength = await mockAdb.pair('192.168.1.101:38192', '123');
    expect(invalidLength.success).toBe(false);
  });

  it('supports simulation hooks for device connect/disconnect', async () => {
    mockAdb.simulateDeviceDisconnect('R5CW10ABCDE');
    let devices = await mockAdb.getDevices();
    expect(devices.some((d) => d.serial === 'R5CW10ABCDE')).toBe(false);

    mockAdb.simulateDeviceConnect(MOCK_SAMSUNG_S24);
    devices = await mockAdb.getDevices();
    expect(devices.some((d) => d.serial === 'R5CW10ABCDE')).toBe(true);
  });
});

describe('MockScrcpyRunner', () => {
  let mockRunner: MockScrcpyRunner;

  beforeEach(() => {
    mockRunner = new MockScrcpyRunner();
    mockRunner.reset();
  });

  it('checkScrcpyInstalled returns mock version 5.0.1', async () => {
    const info = await mockRunner.checkScrcpyInstalled();
    expect(info.installed).toBe(true);
    expect(info.version).toContain('5.0.1');
  });

  it('spawnSession creates child handle and records CLI args', async () => {
    const args = ['--serial', 'R5CW10ABCDE', '--new-display=1920x1080/240', '--stay-awake'];
    const handle = await mockRunner.spawnSession(args);

    expect(handle.pid).toBeGreaterThan(0);
    expect(mockRunner.getLastSpawnedArgs()).toEqual(args);
    expect(mockRunner.getActivePids()).toContain(handle.pid);

    const killed = await mockRunner.killProcess(handle.pid);
    expect(killed).toBe(true);
  });

  it('killProcess terminates process handle', async () => {
    const handle = await mockRunner.spawnSession(['--serial', 'R5CW10ABCDE']);
    let exitFired = false;
    handle.on('exit', () => {
      exitFired = true;
    });

    handle.kill('SIGTERM');
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(exitFired).toBe(true);
    expect(handle.killed).toBe(true);
  });

  it('simulates error output when --simulate-error requested', async () => {
    const handle = await mockRunner.spawnSession(['--simulate-error']);
    let stderrData = '';
    handle.stderr.on('data', (chunk) => {
      stderrData += chunk.toString();
    });

    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(stderrData).toContain('ERROR');
  });
});

describe('factory & DI', () => {
  beforeEach(() => {
    resetAdapters();
  });

  it('isMockMode evaluates to true in test environment', () => {
    expect(isMockMode()).toBe(true);
  });

  it('getAdapters returns mock implementations in test mode', () => {
    const adapters = getAdapters();
    expect(adapters.isMock).toBe(true);
    expect(adapters.adb).toBeInstanceOf(MockAdbExecutor);
    expect(adapters.scrcpy).toBeInstanceOf(MockScrcpyRunner);
  });

  it('allows setting custom adapter instances', () => {
    const customAdb = new MockAdbExecutor([]);
    setAdbExecutor(customAdb);
    const adapters = getAdapters();
    expect(adapters.adb).toBe(customAdb);
  });
});
