import { EventEmitter } from 'node:events';
import type { IScrcpyProcessRunner, IChildProcessHandle } from '../adapters/IScrcpyProcessRunner';
import type {
  ActiveSession,
  LaunchConfig,
  LaunchProfile,
  LaunchSessionResult,
  OperationResult,
  SessionLogEntry,
  SessionStatus,
} from '../../../src/types';
import {
  buildScrcpyArgs,
  resolveResolution,
  clampDpi,
  RESOLUTION_PRESETS,
  DEFAULT_DPIS,
  getDefaultDpi,
  sanitizeTitle,
  validateLaunchConfig,
  type ResolutionDimension,
} from './scrcpyArgs';

// Re-export CLI argument helpers for convenient consumption
export {
  buildScrcpyArgs,
  resolveResolution,
  clampDpi,
  RESOLUTION_PRESETS,
  DEFAULT_DPIS,
  getDefaultDpi,
  sanitizeTitle,
  validateLaunchConfig,
  type ResolutionDimension,
};

export class RingBuffer<T> {
  private readonly buffer: (T | undefined)[];
  private head = 0;
  private count = 0;
  public readonly capacity: number;

  constructor(capacity = 500) {
    this.capacity = capacity;
    this.buffer = new Array<T | undefined>(capacity);
  }

  public push(item: T): void {
    if (this.count < this.capacity) {
      this.buffer[(this.head + this.count) % this.capacity] = item;
      this.count++;
    } else {
      this.buffer[this.head] = item;
      this.head = (this.head + 1) % this.capacity;
    }
  }

  public toArray(): T[] {
    const result: T[] = new Array(this.count);
    for (let i = 0; i < this.count; i++) {
      result[i] = this.buffer[(this.head + i) % this.capacity] as T;
    }
    return result;
  }

  public clear(): void {
    this.buffer.fill(undefined);
    this.head = 0;
    this.count = 0;
  }

  public size(): number {
    return this.count;
  }
}

export class StreamLineSplitter {
  private remainder = '';

  constructor(private readonly onLine: (line: string) => void) {}

  public feed(chunk: Buffer | string): void {
    const text = this.remainder + chunk.toString();
    const lines = text.split(/\r?\n/);
    this.remainder = lines.pop() ?? '';
    for (const line of lines) {
      if (line.length > 0) {
        this.onLine(line);
      }
    }
  }

  public flush(): void {
    if (this.remainder.trim().length > 0) {
      this.onLine(this.remainder);
      this.remainder = '';
    }
  }
}

interface InternalSession extends ActiveSession {
  childHandle?: IChildProcessHandle;
  logBuffer: RingBuffer<string>;
  stdoutSplitter?: StreamLineSplitter;
  stderrSplitter?: StreamLineSplitter;
  killTimer: NodeJS.Timeout | null;
  stopDeferred?: {
    resolve: (res: OperationResult) => void;
    reject: (err: unknown) => void;
  };
}

export interface SessionLauncherOptions {
  /** Maximum number of log lines preserved per session (default: 500) */
  maxLogLines?: number;
  /** Escalation delay from SIGTERM to SIGKILL in milliseconds (default: 2000) */
  killEscalationDelayMs?: number;
  /** Alias for killEscalationDelayMs */
  killTimeoutMs?: number;
  /** Maximum number of terminated sessions retained in history for log review (default: 20) */
  maxCompletedSessions?: number;
}

export class SessionLauncher extends EventEmitter {
  private readonly scrcpy: IScrcpyProcessRunner;
  private readonly maxLogLines: number;
  private readonly killEscalationDelayMs: number;
  private readonly maxCompletedSessions: number;

  private sessions: Map<string, InternalSession> = new Map();
  private completedSessionOrder: string[] = [];
  private isDisposed = false;

  constructor(scrcpy: IScrcpyProcessRunner, options: SessionLauncherOptions = {}) {
    super();
    this.scrcpy = scrcpy;
    this.maxLogLines = options.maxLogLines ?? 500;
    this.killEscalationDelayMs = options.killTimeoutMs ?? options.killEscalationDelayMs ?? 2000;
    this.maxCompletedSessions = options.maxCompletedSessions ?? 20;
  }

  /**
   * Spawns a new scrcpy session for the specified device configuration.
   * Enforces single-session-per-device rule with synchronous reservation.
   */
  public async launchSession(config: LaunchConfig): Promise<LaunchSessionResult> {
    if (this.isDisposed) {
      return { success: false, error: 'SessionLauncher is disposed' };
    }
    if (!config || !config.serial) {
      return { success: false, error: 'Device serial is required' };
    }

    // 1. Verify scrcpy installation
    const scrcpyStatus = await this.scrcpy.checkScrcpyInstalled();
    if (!scrcpyStatus.installed) {
      return {
        success: false,
        error: `scrcpy is not installed or not found: ${scrcpyStatus.error ?? 'binary missing'}`,
      };
    }

    // 2. Single-session-per-device check
    const active = this.getActiveSessionForDevice(config.serial);
    if (active) {
      return {
        success: false,
        error: `A session is already active for device ${config.serial} (${active.sessionId} in state ${active.status})`,
      };
    }

    // 3. Synchronously reserve session slot in 'starting' status
    const sessionId = `session_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
    const session: InternalSession = {
      sessionId,
      deviceSerial: config.serial,
      profile: config.profile,
      pid: 0,
      startedAt: new Date().toISOString(),
      config: { ...config },
      status: 'starting',
      logBuffer: new RingBuffer<string>(this.maxLogLines),
      killTimer: null,
    };

    this.sessions.set(sessionId, session);
    this.emitStatus(session);

    // 4. Build arguments and spawn child process
    try {
      const args = buildScrcpyArgs(config);
      const childHandle = await this.scrcpy.spawnSession(args);

      if (this.isDisposed) {
        childHandle.kill('SIGKILL');
        return { success: false, error: 'SessionLauncher is disposed' };
      }

      session.pid = childHandle.pid;
      session.status = 'running';
      session.childHandle = childHandle;

      // 5. Attach streams and process monitoring
      this.attachProcessMonitoring(session, childHandle);

      this.emitStatus(session);
      return { success: true, sessionId };
    } catch (err: any) {
      session.status = 'error';
      session.error = err?.message || String(err);
      this.emitStatus(session);
      this.pruneCompletedSessions(sessionId);
      return { success: false, error: session.error };
    }
  }

  /**
   * Gracefully stops a running session with configurable SIGKILL escalation.
   */
  public async stopSession(sessionId: string): Promise<OperationResult> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return { success: false, error: `Session not found: ${sessionId}` };
    }

    if (session.status === 'terminated' || session.status === 'error') {
      return { success: true };
    }

    if (session.status === 'stopping') {
      return new Promise<OperationResult>((resolve, reject) => {
        const prevResolve = session.stopDeferred?.resolve;
        const prevReject = session.stopDeferred?.reject;
        session.stopDeferred = {
          resolve: (res) => {
            if (prevResolve) prevResolve(res);
            resolve(res);
          },
          reject: (err) => {
            if (prevReject) prevReject(err);
            reject(err);
          },
        };
      });
    }

    session.status = 'stopping';
    this.emitStatus(session);

    const stopPromise = new Promise<OperationResult>((resolve, reject) => {
      session.stopDeferred = { resolve, reject };
    });

    // Send SIGTERM
    try {
      if (session.childHandle) {
        session.childHandle.kill('SIGTERM');
      } else if (session.pid > 0) {
        void this.scrcpy.killProcess(session.pid, 'SIGTERM');
      }
    } catch {
      // Ignore initial signal delivery failure; escalation timer will handle
    }

    // Arm SIGKILL escalation timer
    session.killTimer = setTimeout(() => {
      if (session.status === 'stopping') {
        const warning = `[SYSTEM] Process ${session.pid} did not exit within ${this.killEscalationDelayMs}ms; escalating to SIGKILL.`;
        session.logBuffer.push(warning);
        this.emitLog({ sessionId: session.sessionId, text: warning } as SessionLogEntry);

        try {
          if (session.childHandle) {
            session.childHandle.kill('SIGKILL');
          } else if (session.pid > 0) {
            void this.scrcpy.killProcess(session.pid, 'SIGKILL');
          }
        } catch {
          // Process may have exited concurrently
        }
      }
    }, this.killEscalationDelayMs);

    return stopPromise;
  }

  /**
   * Returns snapshot of all currently active sessions (starting, running, stopping).
   */
  public getActiveSessions(): ActiveSession[] {
    const list: ActiveSession[] = [];
    for (const session of this.sessions.values()) {
      if (session.status === 'starting' || session.status === 'running' || session.status === 'stopping') {
        list.push(session);
      }
    }
    return list;
  }

  /**
   * Returns snapshot of all tracked sessions (including terminated).
   */
  public getAllSessions(): ActiveSession[] {
    return Array.from(this.sessions.values());
  }

  /**
   * Retrieves ring buffer logs for a specific session.
   */
  public getSessionLogs(sessionId: string): string[] {
    const session = this.sessions.get(sessionId);
    if (!session) return [];
    return session.logBuffer.toArray();
  }

  /**
   * Retrieves a session by its sessionId.
   */
  public getSession(sessionId: string): ActiveSession | undefined {
    return this.sessions.get(sessionId);
  }

  /**
   * Returns active session for a specific device serial, or undefined.
   */
  public getActiveSessionForDevice(serial: string): ActiveSession | undefined {
    for (const session of this.sessions.values()) {
      if (
        session.deviceSerial === serial &&
        (session.status === 'starting' || session.status === 'running' || session.status === 'stopping')
      ) {
        return session;
      }
    }
    return undefined;
  }

  /**
   * Convenience alias for getSession
   */
  public getActiveSession(sessionId: string): ActiveSession | undefined {
    return this.getSession(sessionId);
  }

  /**
   * Stops all running sessions
   */
  public async stopAllSessions(): Promise<void> {
    const active = this.getActiveSessions();
    for (const sess of active) {
      await this.stopSession(sess.sessionId);
    }
  }

  /**
   * Cleans up all running sessions, cancels timers, and detaches listeners.
   */
  public dispose(): void {
    if (this.isDisposed) return;
    this.isDisposed = true;

    for (const session of this.sessions.values()) {
      if (session.killTimer) {
        clearTimeout(session.killTimer);
        session.killTimer = null;
      }
      if (session.status === 'starting' || session.status === 'running' || session.status === 'stopping') {
        try {
          if (session.childHandle) {
            session.childHandle.kill('SIGKILL');
          } else if (session.pid > 0) {
            void this.scrcpy.killProcess(session.pid, 'SIGKILL');
          }
        } catch {
          // Ignore
        }
        session.status = 'terminated';
      }
    }

    if (typeof (this.scrcpy as any).cleanupAll === 'function') {
      try {
        (this.scrcpy as any).cleanupAll();
      } catch {
        // Ignore
      }
    }

    this.sessions.clear();
    this.completedSessionOrder = [];
    this.removeAllListeners();
  }

  private emitStatus(session: ActiveSession): void {
    this.emit('session-status-changed', session);
    this.emit('sessionStatusChanged', session);
  }

  private emitLog(entry: SessionLogEntry): void {
    this.emit('session-log', entry);
    this.emit('sessionLog', entry);
  }

  // --- Private Stream and Lifecycle Helpers ---

  private attachProcessMonitoring(session: InternalSession, child: IChildProcessHandle): void {
    const handleLogLine = (line: string) => {
      session.logBuffer.push(line);
      this.emitLog({
        sessionId: session.sessionId,
        text: line,
      } as SessionLogEntry);
    };

    session.stdoutSplitter = new StreamLineSplitter(handleLogLine);
    session.stderrSplitter = new StreamLineSplitter(handleLogLine);

    child.stdout.on('data', (chunk: Buffer | string) => {
      session.stdoutSplitter?.feed(chunk);
    });

    child.stderr.on('data', (chunk: Buffer | string) => {
      session.stderrSplitter?.feed(chunk);
    });

    let exitHandled = false;
    const handleExit = (code: number | null, signal: NodeJS.Signals | null) => {
      if (exitHandled) return;
      exitHandled = true;

      // Flush remaining line chunks
      session.stdoutSplitter?.flush();
      session.stderrSplitter?.flush();

      // Clear escalation timer
      if (session.killTimer) {
        clearTimeout(session.killTimer);
        session.killTimer = null;
      }

      session.exitCode = code ?? (signal ? 128 : 0);

      if (session.status === 'stopping') {
        session.status = 'terminated';
        session.stopDeferred?.resolve({ success: true });
        session.stopDeferred = undefined;
      } else {
        // Unexpected exit or user closed scrcpy window
        if (code === 0) {
          session.status = 'terminated';
        } else {
          session.status = 'error';
          if (code === 2) {
            session.error = 'Device disconnected while running (exit code 2)';
          } else if (code === 1) {
            session.error = 'Scrcpy initialization or connection failed (exit code 1)';
          } else {
            session.error = `Scrcpy process exited with code ${code}${signal ? ` (signal: ${signal})` : ''}`;
          }
        }
      }

      this.emitStatus(session);
      this.pruneCompletedSessions(session.sessionId);
    };

    child.on('exit', handleExit);
    child.on('close', handleExit);

    child.on('error', (err: Error) => {
      if (session.killTimer) {
        clearTimeout(session.killTimer);
        session.killTimer = null;
      }
      session.status = 'error';
      session.error = err.message;
      session.logBuffer.push(`[ERROR] Process error: ${err.message}`);
      this.emitLog({ sessionId: session.sessionId, text: `[ERROR] ${err.message}` } as SessionLogEntry);
      this.emitStatus(session);
      session.stopDeferred?.reject(err);
      session.stopDeferred = undefined;
      this.pruneCompletedSessions(session.sessionId);
    });
  }

  private pruneCompletedSessions(sessionId: string): void {
    this.completedSessionOrder.push(sessionId);
    while (this.completedSessionOrder.length > this.maxCompletedSessions) {
      const oldestId = this.completedSessionOrder.shift();
      if (oldestId) {
        const oldest = this.sessions.get(oldestId);
        if (oldest && (oldest.status === 'terminated' || oldest.status === 'error')) {
          this.sessions.delete(oldestId);
        }
      }
    }
  }
}
