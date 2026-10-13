import { EventEmitter } from 'node:events';

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

export interface ActiveSession {
  sessionId: string;
  deviceSerial: string;
  profile: LaunchProfile;
  pid: number;
  startedAt: string;
  config: LaunchConfig;
  status: 'starting' | 'running' | 'stopping' | 'terminated' | 'error';
  exitCode?: number;
  error?: string;
}

export interface IChildProcessHandle extends EventEmitter {
  pid: number;
  stdout: NodeJS.ReadableStream;
  stderr: NodeJS.ReadableStream;
  kill(signal?: NodeJS.Signals): boolean;
  killed?: boolean;
}

export interface ScrcpyInstallationInfo {
  installed: boolean;
  path: string;
  version?: string;
  error?: string;
}

export interface IScrcpyProcessRunner {
  /**
   * Verifies that scrcpy is installed on host
   */
  checkScrcpyInstalled(): Promise<ScrcpyInstallationInfo>;

  /**
   * Spawns a scrcpy session with provided CLI flags
   */
  spawnSession(args: string[], options?: { env?: NodeJS.ProcessEnv }): Promise<IChildProcessHandle>;

  /**
   * Gracefully or forcefully terminates an active scrcpy process
   */
  killProcess(pid: number, signal?: NodeJS.Signals): Promise<boolean>;

  /**
   * Inspection methods for test verification
   */
  getLastSpawnedArgs?(): string[];
  getAllSpawnedArgs?(): string[][];
}
