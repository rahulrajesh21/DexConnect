import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs';
import path from 'node:path';
import type {
  IAdbExecutor,
  DeviceRawRecord,
  BatteryInfo,
  AdbCommandResult,
  AdbInstallationInfo,
} from './IAdbExecutor';

const execFileAsync = promisify(execFile);

export class SystemAdbExecutor implements IAdbExecutor {
  private resolvedAdbPath: string | null = null;
  private readonly defaultTimeoutMs: number = 10000;
  private readonly maxBufferBytes: number = 10 * 1024 * 1024; // 10MB

  constructor(customPath?: string) {
    if (customPath) {
      this.resolvedAdbPath = customPath;
    }
  }

  /**
   * Resolves the adb binary path checking standard macOS Homebrew and SDK locations
   */
  public resolveAdbPath(): string {
    if (this.resolvedAdbPath && fs.existsSync(this.resolvedAdbPath)) {
      return this.resolvedAdbPath;
    }

    const candidates = [
      '/opt/homebrew/bin/adb', // Apple Silicon Homebrew
      '/usr/local/bin/adb',   // Intel Mac Homebrew
      process.env.ANDROID_HOME ? path.join(process.env.ANDROID_HOME, 'platform-tools', 'adb') : '',
      process.env.ANDROID_SDK_ROOT ? path.join(process.env.ANDROID_SDK_ROOT, 'platform-tools', 'adb') : '',
      process.env.HOME ? path.join(process.env.HOME, 'Library', 'Android', 'sdk', 'platform-tools', 'adb') : '',
    ].filter(Boolean);

    for (const candidate of candidates) {
      if (fs.existsSync(candidate)) {
        this.resolvedAdbPath = candidate;
        return candidate;
      }
    }

    // Fallback to system PATH
    this.resolvedAdbPath = 'adb';
    return this.resolvedAdbPath;
  }

  /**
   * Executes an adb command with arguments, stripping daemon startup lines
   */
  private async runAdb(args: string[], timeoutMs = this.defaultTimeoutMs): Promise<string> {
    const adbPath = this.resolveAdbPath();
    try {
      const { stdout, stderr } = await execFileAsync(adbPath, args, {
        timeout: timeoutMs,
        maxBuffer: this.maxBufferBytes,
        windowsHide: true,
      });

      const combined = stdout || stderr || '';
      return this.cleanDaemonOutput(combined);
    } catch (err: any) {
      const rawOutput = (err.stdout || err.stderr || err.message || '').toString();
      const cleaned = this.cleanDaemonOutput(rawOutput);
      const error = new Error(cleaned || err.message);
      (error as any).code = err.code;
      throw error;
    }
  }

  /**
   * Strips '* daemon not running...' messages
   */
  public cleanDaemonOutput(output: string): string {
    return output
      .split('\n')
      .filter((line) => {
        const trimmed = line.trim();
        return !trimmed.startsWith('* daemon') && !trimmed.startsWith('* daemon started');
      })
      .join('\n')
      .trim();
  }

  public async checkAdbInstalled(): Promise<AdbInstallationInfo> {
    try {
      const output = await this.runAdb(['version']);
      const match = output.match(/(?:Android Debug Bridge version |version )([0-9.]+)/i);
      const version = match ? match[1] : output.split('\n')[0];
      return {
        installed: true,
        path: this.resolveAdbPath(),
        version,
      };
    } catch (err: any) {
      return {
        installed: false,
        path: this.resolveAdbPath(),
        error: err.message,
      };
    }
  }

  public async getDevices(): Promise<DeviceRawRecord[]> {
    const output = await this.runAdb(['devices', '-l']);
    const lines = output.split('\n').map((l) => l.trim()).filter(Boolean);
    const listIndex = lines.findIndex((l) => l.startsWith('List of devices attached'));
    if (listIndex === -1) return [];

    const deviceLines = lines.slice(listIndex + 1);
    const records: DeviceRawRecord[] = [];

    for (const line of deviceLines) {
      const parts = line.split(/\s+/);
      if (parts.length < 2) continue;

      const serial = parts[0];
      const rawState = parts[1].toLowerCase();
      let state: DeviceRawRecord['state'] = 'unknown';
      if (rawState === 'device') state = 'device';
      else if (rawState === 'unauthorized') state = 'unauthorized';
      else if (rawState === 'offline') state = 'offline';

      const record: DeviceRawRecord = { serial, state };

      for (let i = 2; i < parts.length; i++) {
        const [key, value] = parts[i].split(':');
        if (!key || !value) continue;
        if (key === 'product') record.product = value;
        else if (key === 'model') record.model = value;
        else if (key === 'device') record.device = value;
        else if (key === 'transport_id') record.transportId = value;
      }

      records.push(record);
    }

    return records;
  }

  public async getProp(serial: string, prop: string): Promise<string> {
    try {
      const output = await this.runAdb(['-s', serial, 'shell', 'getprop', prop]);
      return output.trim();
    } catch {
      return '';
    }
  }

  public async getBatteryInfo(serial: string): Promise<BatteryInfo> {
    const output = await this.runAdb(['-s', serial, 'shell', 'dumpsys', 'battery']);
    let level = 0;
    let scale = 100;
    let status = 1;
    let acPowered = false;
    let usbPowered = false;
    let wirelessPowered = false;

    for (const line of output.split('\n')) {
      const [key, value] = line.trim().split(':').map((s) => s?.trim());
      if (!key || value === undefined) continue;

      const k = key.toLowerCase();
      if (k === 'level') level = parseInt(value, 10) || 0;
      else if (k === 'scale') scale = parseInt(value, 10) || 100;
      else if (k === 'status') status = parseInt(value, 10) || 1;
      else if (k === 'ac powered') acPowered = value.toLowerCase() === 'true';
      else if (k === 'usb powered') usbPowered = value.toLowerCase() === 'true';
      else if (k === 'wireless powered') wirelessPowered = value.toLowerCase() === 'true';
    }

    let powerSource: BatteryInfo['powerSource'] = 'battery';
    if (acPowered) powerSource = 'ac';
    else if (usbPowered) powerSource = 'usb';
    else if (wirelessPowered) powerSource = 'wireless';

    const isCharging = status === 2 || acPowered || usbPowered || wirelessPowered;

    return {
      level,
      scale,
      status,
      isCharging,
      powerSource,
    };
  }

  public async getDeviceIp(serial: string): Promise<string | null> {
    // Strategy 1: check ip route
    try {
      const routeOutput = await this.runAdb(['-s', serial, 'shell', 'ip', 'route']);
      const match = routeOutput.match(/src\s+(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})/);
      if (match && match[1]) return match[1];
    } catch {
      // Fallback
    }

    // Strategy 2: check ip addr show wlan0
    try {
      const addrOutput = await this.runAdb(['-s', serial, 'shell', 'ip', 'addr', 'show', 'wlan0']);
      const match = addrOutput.match(/inet\s+(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})/);
      if (match && match[1]) return match[1];
    } catch {
      // Fallback
    }

    // Strategy 3: check getprop dhcp.wlan0.ipaddress
    try {
      const propIp = await this.getProp(serial, 'dhcp.wlan0.ipaddress');
      if (propIp && /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(propIp)) {
        return propIp;
      }
    } catch {
      // Fallback
    }

    return null;
  }

  public async switchTcpip(serial: string, port: number): Promise<AdbCommandResult> {
    try {
      const output = await this.runAdb(['-s', serial, 'tcpip', port.toString()]);
      const success = output.toLowerCase().includes('restarting in tcp mode') || output.trim() === '';
      return { success, output };
    } catch (err: any) {
      return { success: false, output: err.message, error: err.message };
    }
  }

  public async connect(address: string): Promise<AdbCommandResult> {
    try {
      const output = await this.runAdb(['connect', address]);
      const lower = output.toLowerCase();
      const success = lower.includes('connected to') || lower.includes('already connected');
      return { success, output };
    } catch (err: any) {
      return { success: false, output: err.message, error: err.message };
    }
  }

  public async disconnect(address?: string): Promise<AdbCommandResult> {
    try {
      const args = address ? ['disconnect', address] : ['disconnect'];
      const output = await this.runAdb(args);
      return { success: true, output };
    } catch (err: any) {
      return { success: false, output: err.message, error: err.message };
    }
  }

  public async pair(addressWithPort: string, code: string): Promise<AdbCommandResult> {
    try {
      const output = await this.runAdb(['pair', addressWithPort, code]);
      const success = output.toLowerCase().includes('successfully paired');
      return { success, output };
    } catch (err: any) {
      return { success: false, output: err.message, error: err.message };
    }
  }

  public async executeRaw(args: string[]): Promise<AdbCommandResult> {
    try {
      const output = await this.runAdb(args);
      return { success: true, output };
    } catch (err: any) {
      return { success: false, output: err.message, error: err.message };
    }
  }
}
