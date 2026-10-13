import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import type {
  IScrcpyProcessRunner,
  IChildProcessHandle,
  ScrcpyInstallationInfo,
} from './IScrcpyProcessRunner';

export class MockChildProcessHandle extends EventEmitter implements IChildProcessHandle {
  public pid: number;
  public stdout: PassThrough;
  public stderr: PassThrough;
  public killed: boolean = false;
  public exitCode: number | null = null;
  public ignoreSigterm: boolean = false;
  public killSignalsReceived: NodeJS.Signals[] = [];

  constructor(pid: number) {
    super();
    this.pid = pid;
    this.stdout = new PassThrough();
    this.stderr = new PassThrough();
  }

  public kill(signal: NodeJS.Signals = 'SIGTERM'): boolean {
    this.killSignalsReceived.push(signal);
    if (this.killed) return true;

    if (signal === 'SIGTERM' && this.ignoreSigterm) {
      // Simulate process hanging / ignoring SIGTERM
      return true;
    }

    this.killed = true;
    const code = signal === 'SIGKILL' ? 137 : 0;
    this.exitCode = code;

    this.stdout.end();
    this.stderr.end();

    process.nextTick(() => {
      this.emit('exit', code, signal);
      this.emit('close', code, signal);
    });

    return true;
  }
}

export class MockScrcpyRunner implements IScrcpyProcessRunner {
  private nextPid = 20001;
  private lastArgs: string[] = [];
  private allArgs: string[][] = [];
  private activeHandles: Map<number, MockChildProcessHandle> = new Map();
  private allHandles: Map<number, MockChildProcessHandle> = new Map();
  private handleArgs: Map<number, string[]> = new Map();
  private scrcpyInstalled = true;
  private scrcpyVersion = 'scrcpy 5.0.1';
  public simulateStubbornProcess = false;

  public async checkScrcpyInstalled(): Promise<ScrcpyInstallationInfo> {
    if (!this.scrcpyInstalled) {
      return { installed: false, path: '/opt/homebrew/bin/scrcpy', error: 'scrcpy not installed' };
    }
    return {
      installed: true,
      path: '/opt/homebrew/bin/scrcpy',
      version: this.scrcpyVersion,
    };
  }

  public async checkVersion(_path: string): Promise<string> {
    return this.scrcpyVersion;
  }

  public async isAvailable(path: string): Promise<boolean> {
    if (path.includes('invalid') || !this.scrcpyInstalled) return false;
    return true;
  }

  public async spawn(_path: string, args: string[]): Promise<MockChildProcessHandle> {
    return this.spawnSession(args) as Promise<MockChildProcessHandle>;
  }

  public isRunning(pid: number): boolean {
    const handle = this.activeHandles.get(pid);
    return handle ? !handle.killed : false;
  }

  public getSpawnedProcesses(): Array<{ pid: number; args: string[]; emitStdout: (s: string) => void; emitExit: (c: number) => void }> {
    return Array.from(this.allHandles.values()).map((h) => ({
      pid: h.pid,
      args: this.handleArgs.get(h.pid) || this.lastArgs,
      emitStdout: (s: string) => {
        h.stdout.write(s);
        h.stdout.emit('data', Buffer.from(s));
      },
      emitExit: (c: number) => {
        h.killed = true;
        h.exitCode = c;
        h.stdout.end();
        h.stderr.end();
        h.emit('exit', c);
        h.emit('close', c);
      },
    }));
  }

  public async spawnSession(
    args: string[],
    _options?: { env?: NodeJS.ProcessEnv }
  ): Promise<IChildProcessHandle> {
    this.lastArgs = [...args];
    this.allArgs.push([...args]);

    const pid = this.nextPid++;
    this.handleArgs.set(pid, [...args]);
    const handle = new MockChildProcessHandle(pid);
    if (this.simulateStubbornProcess) {
      handle.ignoreSigterm = true;
    }
    this.activeHandles.set(pid, handle);
    this.allHandles.set(pid, handle);

    handle.on('exit', () => {
      this.activeHandles.delete(pid);
    });

    // Check if error simulation requested in flags
    if (args.includes('--simulate-error')) {
      setTimeout(() => {
        if (!handle.killed) {
          handle.stderr.write('ERROR: Failed to establish display server connection\n');
          handle.kill('SIGTERM');
        }
      }, 50);
      return handle;
    }

    // Emit realistic startup banner
    setTimeout(() => {
      if (!handle.killed) {
        handle.stdout.write(`INFO: scrcpy 5.0.1 <https://github.com/Genymobile/scrcpy>\n`);
        const serialIdx = args.indexOf('--serial') !== -1 ? args.indexOf('--serial') : args.indexOf('-s');
        const serial = serialIdx !== -1 ? args[serialIdx + 1] : 'default';
        handle.stdout.write(`INFO: Executing: [adb, -s, ${serial}, shell, ...]\n`);

        if (args.some((a) => a.startsWith('--new-display'))) {
          const displayArg = args.find((a) => a.startsWith('--new-display'));
          handle.stdout.write(`INFO: New display created: ${displayArg}\n`);
        }
        handle.stdout.write(`INFO: Device connected, display stream active\n`);
      }
    }, 20);

    return handle;
  }

  public async killProcess(pid: number, signal: NodeJS.Signals = 'SIGTERM'): Promise<boolean> {
    const handle = this.activeHandles.get(pid) ?? this.allHandles.get(pid);
    if (handle) {
      return handle.kill(signal);
    }
    return true;
  }

  public getLastSpawnedArgs(): string[] {
    return [...this.lastArgs];
  }

  public getAllSpawnedArgs(): string[][] {
    return this.allArgs.map((a) => [...a]);
  }

  public clearSpawnedArgs(): void {
    this.lastArgs = [];
    this.allArgs = [];
  }

  // --- Test & Simulation Hooks ---

  public setProcessHangOnSigterm(pid: number, hang = true): void {
    const handle = this.activeHandles.get(pid) ?? this.allHandles.get(pid);
    if (handle) {
      handle.ignoreSigterm = hang;
    }
  }

  public getSignalsForProcess(pid: number): NodeJS.Signals[] {
    const handle = this.allHandles.get(pid) ?? this.activeHandles.get(pid);
    return handle ? [...handle.killSignalsReceived] : [];
  }

  public simulateOutput(pid: number, text: string, stream: 'stdout' | 'stderr' = 'stdout'): void {
    const handle = this.activeHandles.get(pid) ?? this.allHandles.get(pid);
    if (handle && !handle.killed) {
      if (stream === 'stdout') handle.stdout.write(`${text}\n`);
      else handle.stderr.write(`${text}\n`);
    }
  }

  public simulateExit(pid: number, code = 0, signal: NodeJS.Signals | null = null): void {
    const handle = this.activeHandles.get(pid) ?? this.allHandles.get(pid);
    if (handle) {
      handle.killed = true;
      handle.exitCode = code;
      handle.stdout.end();
      handle.stderr.end();
      handle.emit('exit', code, signal);
      handle.emit('close', code, signal);
    }
  }

  public getActivePids(): number[] {
    const pids: number[] = [];
    for (const [pid, handle] of this.activeHandles) {
      if (!handle.killed) {
        pids.push(pid);
      }
    }
    return pids;
  }

  public reset(): void {
    for (const [, handle] of this.activeHandles) {
      handle.kill('SIGKILL');
    }
    this.activeHandles.clear();
    this.allHandles.clear();
    this.clearSpawnedArgs();
  }
}
