import { spawn, execFile, ChildProcess } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs';
import type {
  IScrcpyProcessRunner,
  IChildProcessHandle,
  ScrcpyInstallationInfo,
} from './IScrcpyProcessRunner';

const execFileAsync = promisify(execFile);

export class SystemScrcpyRunner implements IScrcpyProcessRunner {
  private resolvedScrcpyPath: string | null = null;
  private activeProcesses: Map<number, ChildProcess> = new Map();
  private lastArgs: string[] = [];
  private allArgs: string[][] = [];

  constructor(customPath?: string) {
    if (customPath) {
      this.resolvedScrcpyPath = customPath;
    }
  }

  public resolveScrcpyPath(): string {
    if (this.resolvedScrcpyPath && fs.existsSync(this.resolvedScrcpyPath)) {
      return this.resolvedScrcpyPath;
    }

    const candidates = [
      '/opt/homebrew/bin/scrcpy', // macOS Apple Silicon Homebrew
      '/usr/local/bin/scrcpy',   // macOS Intel Homebrew
    ];

    for (const candidate of candidates) {
      if (fs.existsSync(candidate)) {
        this.resolvedScrcpyPath = candidate;
        return candidate;
      }
    }

    this.resolvedScrcpyPath = 'scrcpy';
    return this.resolvedScrcpyPath;
  }

  public async checkScrcpyInstalled(): Promise<ScrcpyInstallationInfo> {
    const scrcpyPath = this.resolveScrcpyPath();
    try {
      const { stdout } = await execFileAsync(scrcpyPath, ['--version'], {
        timeout: 5000,
        windowsHide: true,
      });

      const match = stdout.match(/scrcpy\s+([0-9.]+)/i);
      const version = match ? match[1] : stdout.split('\n')[0].trim();
      return {
        installed: true,
        path: scrcpyPath,
        version,
      };
    } catch (err: any) {
      return {
        installed: false,
        path: scrcpyPath,
        error: err.message,
      };
    }
  }

  public async spawnSession(
    args: string[],
    options?: { env?: NodeJS.ProcessEnv }
  ): Promise<IChildProcessHandle> {
    const scrcpyPath = this.resolveScrcpyPath();
    this.lastArgs = [...args];
    this.allArgs.push([...args]);

    // Ensure ADB environment is explicitly propagated to avoid PATH issues
    const env = {
      ...process.env,
      ...options?.env,
    };

    if (!env.ADB && fs.existsSync('/opt/homebrew/bin/adb')) {
      env.ADB = '/opt/homebrew/bin/adb';
    }

    const child = spawn(scrcpyPath, args, {
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: false,
    });

    if (!child.pid) {
      throw new Error(`Failed to spawn scrcpy process using path ${scrcpyPath}`);
    }

    const pid = child.pid;
    this.activeProcesses.set(pid, child);

    child.on('exit', () => {
      this.activeProcesses.delete(pid);
    });

    return child as unknown as IChildProcessHandle;
  }

  public async killProcess(pid: number, signal: NodeJS.Signals = 'SIGTERM'): Promise<boolean> {
    const child = this.activeProcesses.get(pid);
    try {
      if (child) {
        child.kill(signal);
      } else {
        process.kill(pid, signal);
      }

      // If graceful SIGTERM was sent, schedule SIGKILL escalation after 1500ms
      if (signal === 'SIGTERM') {
        setTimeout(() => {
          try {
            process.kill(pid, 0); // check if alive
            process.kill(pid, 'SIGKILL');
          } catch {
            // Already dead
          }
        }, 1500);
      }

      return true;
    } catch (err: any) {
      if (err.code === 'ESRCH') return true; // Already exited
      return false;
    }
  }

  public getLastSpawnedArgs(): string[] {
    return [...this.lastArgs];
  }

  public getAllSpawnedArgs(): string[][] {
    return this.allArgs.map((a) => [...a]);
  }

  public cleanupAll(): void {
    for (const [, child] of this.activeProcesses) {
      try {
        child.kill('SIGKILL');
      } catch {
        // Ignore
      }
    }
    this.activeProcesses.clear();
  }
}
