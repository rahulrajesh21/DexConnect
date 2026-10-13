import { describe, it, expect, beforeEach } from 'vitest';
import {
  SystemAdbExecutor,
  MockAdbExecutor,
  MockScrcpyRunner,
} from '../../electron/main/adapters';
import type { MockDeviceState } from '../../electron/main/adapters/MockAdbExecutor';
import type { MockChildProcessHandle } from '../../electron/main/adapters/MockScrcpyRunner';

describe('Adversarial Stress Test: SystemAdbExecutor daemon cleaning', () => {
  let executor: SystemAdbExecutor;

  beforeEach(() => {
    executor = new SystemAdbExecutor();
  });

  it('handles multiple consecutive daemon restart notices', () => {
    const raw = [
      '* daemon not running; starting now at tcp:5037',
      '* daemon not running; starting now at tcp:5037',
      '* daemon started successfully',
      'List of devices attached',
      'R5CW10ABCDE\tdevice\tproduct:e3q model:SM-S928B device:e3q transport_id:1',
    ].join('\n');

    const cleaned = executor.cleanDaemonOutput(raw);
    expect(cleaned).not.toContain('* daemon');
    expect(cleaned).toBe(
      'List of devices attached\nR5CW10ABCDE\tdevice\tproduct:e3q model:SM-S928B device:e3q transport_id:1'
    );
  });

  it('handles CRLF line endings in daemon output', () => {
    const raw =
      '* daemon not running; starting now at tcp:5037\r\n' +
      '* daemon started successfully\r\n' +
      'List of devices attached\r\n' +
      'ZY22ABCD12\tdevice\r\n';

    const cleaned = executor.cleanDaemonOutput(raw);
    expect(cleaned).not.toContain('* daemon');
    expect(cleaned).toContain('List of devices attached');
    expect(cleaned).toContain('ZY22ABCD12');
  });

  it('returns empty string when output consists ONLY of daemon messages', () => {
    const raw =
      '* daemon not running; starting now at tcp:5037\n' +
      '* daemon started successfully\n';

    const cleaned = executor.cleanDaemonOutput(raw);
    expect(cleaned).toBe('');
  });

  it('handles daemon messages with leading whitespace or tabs', () => {
    const raw =
      '   * daemon not running; starting now at tcp:5037\n' +
      '\t* daemon started successfully\n' +
      'List of devices attached';

    const cleaned = executor.cleanDaemonOutput(raw);
    expect(cleaned).toBe('List of devices attached');
  });

  it('preserves non-daemon warning lines and multiline messages', () => {
    const raw = [
      'adb: warning: server version mismatch',
      '* daemon not running; starting now at tcp:5037',
      '* daemon started successfully',
      'List of devices attached',
      'R5CW10ABCDE\tdevice',
    ].join('\n');

    const cleaned = executor.cleanDaemonOutput(raw);
    expect(cleaned).toContain('adb: warning: server version mismatch');
    expect(cleaned).not.toContain('* daemon');
    expect(cleaned).toContain('List of devices attached');
  });

  it('does NOT filter device lines that happen to contain the word "daemon"', () => {
    const raw = [
      'List of devices attached',
      'emulator-5554\tdevice product:sdk_gphone64_arm64 model:sdk device:emulator_daemon',
    ].join('\n');

    const cleaned = executor.cleanDaemonOutput(raw);
    expect(cleaned).toContain('device:emulator_daemon');
  });
});

describe('Adversarial Stress Test: MockAdbExecutor state machine', () => {
  let mockAdb: MockAdbExecutor;

  beforeEach(() => {
    mockAdb = new MockAdbExecutor();
  });

  describe('switchTcpip edge cases', () => {
    it('returns failure for non-existent serial', async () => {
      const res = await mockAdb.switchTcpip('NON_EXISTENT_SERIAL_999', 5555);
      expect(res.success).toBe(false);
      expect(res.output).toContain("error: device 'NON_EXISTENT_SERIAL_999' not found");
    });

    it('returns failure for empty string serial', async () => {
      const res = await mockAdb.switchTcpip('', 5555);
      expect(res.success).toBe(false);
      expect(res.output).toContain("error: device '' not found");
    });

    it('successfully switches valid device and sets tcpipPort property', async () => {
      const res = await mockAdb.switchTcpip('R5CW10ABCDE', 5555);
      expect(res.success).toBe(true);
      expect(res.output).toContain('restarting in TCP mode port: 5555');

      // Port can be switched to alternative port like 5557
      const resAlt = await mockAdb.switchTcpip('R5CW10ABCDE', 5557);
      expect(resAlt.success).toBe(true);
      expect(resAlt.output).toContain('restarting in TCP mode port: 5557');
    });
  });

  describe('connect edge cases', () => {
    it('returns already connected for existing wireless fixture device', async () => {
      // 192.168.1.103:5555 exists in DEFAULT_MOCK_DEVICES
      const resWithPort = await mockAdb.connect('192.168.1.103:5555');
      expect(resWithPort.success).toBe(true);
      expect(resWithPort.output).toBe('already connected to 192.168.1.103:5555');

      // Without port should append :5555 and still detect already connected
      const resWithoutPort = await mockAdb.connect('192.168.1.103');
      expect(resWithoutPort.success).toBe(true);
      expect(resWithoutPort.output).toBe('already connected to 192.168.1.103:5555');
    });

    it('connects to USB device IP and subsequent call reports already connected', async () => {
      // Connect to Samsung S24 IP (192.168.1.101)
      const firstConnect = await mockAdb.connect('192.168.1.101:5555');
      expect(firstConnect.success).toBe(true);
      expect(firstConnect.output).toBe('connected to 192.168.1.101:5555');

      // New device should appear in devices list
      const devices = await mockAdb.getDevices();
      const wifiDev = devices.find((d) => d.serial === '192.168.1.101:5555');
      expect(wifiDev).toBeDefined();
      expect(wifiDev?.model).toBe('SM-S928B');

      // Second connect call should return "already connected"
      const secondConnect = await mockAdb.connect('192.168.1.101:5555');
      expect(secondConnect.success).toBe(true);
      expect(secondConnect.output).toBe('already connected to 192.168.1.101:5555');

      // Calling connect without port should also report already connected
      const thirdConnect = await mockAdb.connect('192.168.1.101');
      expect(thirdConnect.success).toBe(true);
      expect(thirdConnect.output).toBe('already connected to 192.168.1.101:5555');
    });

    it('fails to connect to unreachable / unknown IP', async () => {
      const res = await mockAdb.connect('10.200.1.50:5555');
      expect(res.success).toBe(false);
      expect(res.output).toContain('failed to connect to 10.200.1.50:5555: Connection refused');

      const res2 = await mockAdb.connect('192.168.1.254');
      expect(res2.success).toBe(false);
      expect(res2.output).toContain('failed to connect to 192.168.1.254:5555: Connection refused');
    });
  });

  describe('disconnect edge cases', () => {
    it('returns error when disconnecting a non-existent device', async () => {
      const res = await mockAdb.disconnect('192.168.1.222:5555');
      expect(res.success).toBe(false);
      expect(res.output).toBe("error: no such device '192.168.1.222:5555'");
    });

    it('disconnecting all wireless devices removes only wireless ones', async () => {
      const res = await mockAdb.disconnect();
      expect(res.success).toBe(true);
      expect(res.output).toBe('disconnected everything');

      const devices = await mockAdb.getDevices();
      // Should have 2 USB devices left (R5CW10ABCDE and ZY22ABCD12), wireless (192.168.1.103:5555) removed
      expect(devices.length).toBe(2);
      expect(devices.every((d) => !d.serial.includes(':'))).toBe(true);
    });

    it('can reconnect after disconnecting', async () => {
      // Disconnect existing wireless device
      const dis = await mockAdb.disconnect('192.168.1.103:5555');
      expect(dis.success).toBe(true);

      // Verify gone
      let devices = await mockAdb.getDevices();
      expect(devices.some((d) => d.serial === '192.168.1.103:5555')).toBe(false);

      // Reconnect (192.168.1.103 was wireless, but wait - does connect find it if matching USB device exists?)
      // For USB device 192.168.1.101:
      await mockAdb.connect('192.168.1.101:5555');
      devices = await mockAdb.getDevices();
      expect(devices.some((d) => d.serial === '192.168.1.101:5555')).toBe(true);

      await mockAdb.disconnect('192.168.1.101:5555');
      devices = await mockAdb.getDevices();
      expect(devices.some((d) => d.serial === '192.168.1.101:5555')).toBe(false);

      // Reconnect again
      const recon = await mockAdb.connect('192.168.1.101:5555');
      expect(recon.success).toBe(true);
      devices = await mockAdb.getDevices();
      expect(devices.some((d) => d.serial === '192.168.1.101:5555')).toBe(true);
    });
  });

  describe('pair pairing code adversarial validation', () => {
    it('accepts valid 6-digit PINs', async () => {
      const validPins = ['123456', '987654', '012345', '100000', '999999', '000001'];
      for (const pin of validPins) {
        const res = await mockAdb.pair('192.168.1.101:38192', pin);
        expect(res.success).toBe(true);
        expect(res.output).toContain('Successfully paired');
      }
    });

    it('rejects blacklist PIN "000000"', async () => {
      const res = await mockAdb.pair('192.168.1.101:38192', '000000');
      expect(res.success).toBe(false);
      expect(res.output).toContain('Failed: Wrong password or connection closed.');
    });

    it('rejects invalid lengths', async () => {
      const invalidLengths = ['12345', '1234567', '1', '12', '', '   '];
      for (const pin of invalidLengths) {
        const res = await mockAdb.pair('192.168.1.101:38192', pin);
        expect(res.success).toBe(false);
        expect(res.output).toContain('Failed: Wrong password or connection closed.');
      }
    });

    it('rejects non-digit and malformed PINs', async () => {
      const malformedPins = [
        'abcdef',
        '12a456',
        '12345 ',
        ' 12345',
        '12 456',
        '-12345',
        '12.456',
        '00000O', // capital letter O
      ];
      for (const pin of malformedPins) {
        const res = await mockAdb.pair('192.168.1.101:38192', pin);
        expect(res.success).toBe(false);
        expect(res.output).toContain('Failed: Wrong password or connection closed.');
      }
    });
  });

  describe('rapid connect / disconnect cycle stress test', () => {
    it('survives 100 rapid simulated connect and disconnect cycles without state corruption', async () => {
      const testDevice: MockDeviceState = {
        raw: {
          serial: 'STRESS_TEST_DEVICE_01',
          state: 'device',
          product: 'stress_phone',
          model: 'StressMaster Pro',
          device: 'stress_phone',
          transportId: '99',
        },
        props: {
          'ro.product.manufacturer': 'stress_corp',
          'ro.product.model': 'StressMaster Pro',
          'ro.build.version.release': '15',
        },
        battery: {
          level: 50,
          scale: 100,
          status: 2,
          isCharging: true,
          powerSource: 'usb',
        },
        ipAddress: '192.168.1.222',
        tcpipPort: null,
      };

      for (let i = 0; i < 100; i++) {
        // Connect
        mockAdb.simulateDeviceConnect(testDevice);
        let devs = await mockAdb.getDevices();
        expect(devs.some((d) => d.serial === 'STRESS_TEST_DEVICE_01')).toBe(true);

        // Update battery
        mockAdb.simulateBatteryUpdate('STRESS_TEST_DEVICE_01', { level: (i % 100) + 1 });
        const batt = await mockAdb.getBatteryInfo('STRESS_TEST_DEVICE_01');
        expect(batt.level).toBe((i % 100) + 1);

        // Disconnect
        mockAdb.simulateDeviceDisconnect('STRESS_TEST_DEVICE_01');
        devs = await mockAdb.getDevices();
        expect(devs.some((d) => d.serial === 'STRESS_TEST_DEVICE_01')).toBe(false);

        // Battery call should fail after disconnect
        await expect(mockAdb.getBatteryInfo('STRESS_TEST_DEVICE_01')).rejects.toThrow(
          "Device 'STRESS_TEST_DEVICE_01' not found"
        );
      }

      // Base devices remain untouched
      const finalDevices = await mockAdb.getDevices();
      expect(finalDevices.length).toBe(3);
    });
  });
});

describe('Adversarial Stress Test: MockScrcpyRunner', () => {
  let runner: MockScrcpyRunner;

  beforeEach(() => {
    runner = new MockScrcpyRunner();
    runner.reset();
  });

  it('records spawned arguments array accurately across multiple invocations', async () => {
    const args1 = [
      '--serial',
      'R5CW10ABCDE',
      '--new-display=1920x1080/240',
      '--stay-awake',
      '--audio-source=playback',
      '--keyboard=uhid',
      '--mouse=uhid',
    ];
    await runner.spawnSession(args1);
    expect(runner.getLastSpawnedArgs()).toEqual(args1);

    const args2 = [
      '--serial',
      'ZY22ABCD12',
      '--turn-screen-off',
      '--stay-awake',
      '--video-codec=h265',
      '--max-fps=120',
    ];
    await runner.spawnSession(args2);
    expect(runner.getLastSpawnedArgs()).toEqual(args2);

    const allArgs = runner.getAllSpawnedArgs();
    expect(allArgs.length).toBe(2);
    expect(allArgs[0]).toEqual(args1);
    expect(allArgs[1]).toEqual(args2);

    runner.clearSpawnedArgs();
    expect(runner.getLastSpawnedArgs()).toEqual([]);
    expect(runner.getAllSpawnedArgs()).toEqual([]);
  });

  it('emits correct exit codes on SIGTERM and SIGKILL termination', async () => {
    // Session 1: SIGTERM -> exit code 0
    const handleTerm = await runner.spawnSession(['--serial', 'DEV1']);
    const termPid = handleTerm.pid;
    let termExitCode: number | null = null;
    let termSignal: string | null = null;

    handleTerm.on('exit', (code, signal) => {
      termExitCode = code;
      termSignal = signal;
    });

    await runner.killProcess(termPid, 'SIGTERM');
    await new Promise((resolve) => setTimeout(resolve, 30));

    expect(handleTerm.killed).toBe(true);
    expect(termExitCode).toBe(0);
    expect(termSignal).toBe('SIGTERM');
    expect((handleTerm as MockChildProcessHandle).exitCode).toBe(0);
    expect(runner.getActivePids()).not.toContain(termPid);

    // Session 2: SIGKILL -> exit code 137
    const handleKill = await runner.spawnSession(['--serial', 'DEV2']);
    const killPid = handleKill.pid;
    let killExitCode: number | null = null;
    let killSignal: string | null = null;

    handleKill.on('exit', (code, signal) => {
      killExitCode = code;
      killSignal = signal;
    });

    await runner.killProcess(killPid, 'SIGKILL');
    await new Promise((resolve) => setTimeout(resolve, 30));

    expect(handleKill.killed).toBe(true);
    expect(killExitCode).toBe(137);
    expect(killSignal).toBe('SIGKILL');
    expect((handleKill as MockChildProcessHandle).exitCode).toBe(137);
    expect(runner.getActivePids()).not.toContain(killPid);
  });

  it('supports simulateExit with custom exit code (e.g. exit code 1 or 2 on error)', async () => {
    const handle = await runner.spawnSession(['--serial', 'DEV3']);
    let exitCode: number | null = null;
    handle.on('exit', (code) => {
      exitCode = code;
    });

    runner.simulateExit(handle.pid, 2);
    expect(handle.killed).toBe(true);
    expect((handle as MockChildProcessHandle).exitCode).toBe(2);
    expect(exitCode).toBe(2);
  });

  it('simulates streaming stdout and stderr events and closes streams on exit', async () => {
    const handle = await runner.spawnSession(['--serial', 'DEV4']);
    const stdoutChunks: string[] = [];
    const stderrChunks: string[] = [];

    handle.stdout.on('data', (d) => stdoutChunks.push(d.toString()));
    handle.stderr.on('data', (d) => stderrChunks.push(d.toString()));

    runner.simulateOutput(handle.pid, 'INFO: stream line 1', 'stdout');
    runner.simulateOutput(handle.pid, 'WARN: bitrate dropped', 'stderr');

    expect(stdoutChunks.join('')).toContain('stream line 1');
    expect(stderrChunks.join('')).toContain('bitrate dropped');

    let stdoutClosed = false;
    let stderrClosed = false;
    handle.stdout.on('end', () => {
      stdoutClosed = true;
    });
    handle.stderr.on('end', () => {
      stderrClosed = true;
    });

    await runner.killProcess(handle.pid);
    await new Promise((resolve) => setTimeout(resolve, 30));

    expect(stdoutClosed).toBe(true);
    expect(stderrClosed).toBe(true);
  });

  it('killProcess returns true gracefully for non-existent or already terminated PID', async () => {
    const result = await runner.killProcess(999999);
    expect(result).toBe(true);
  });

  it('reset() terminates all active processes and flushes state', async () => {
    const h1 = await runner.spawnSession(['--serial', 'DEV5']);
    const h2 = await runner.spawnSession(['--serial', 'DEV6']);
    expect(runner.getActivePids()).toContain(h1.pid);
    expect(runner.getActivePids()).toContain(h2.pid);

    runner.reset();
    expect(runner.getActivePids()).toHaveLength(0);
    expect(h1.killed).toBe(true);
    expect(h2.killed).toBe(true);
    expect(runner.getLastSpawnedArgs()).toEqual([]);
  });
});
