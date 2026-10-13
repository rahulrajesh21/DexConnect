import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  SessionLauncher,
  buildScrcpyArgs,
  resolveResolution,
  clampDpi,
  sanitizeTitle,
  validateLaunchConfig,
  StreamLineSplitter,
  RingBuffer,
} from '../../electron/main/services/SessionLauncher';
import { MockScrcpyRunner } from '../../electron/main/adapters/MockScrcpyRunner';
import type { LaunchConfig, ActiveSession, SessionLogEntry } from '../../src/types';

describe('SessionLauncher Unit Tests', () => {
  let mockRunner: MockScrcpyRunner;
  let launcher: SessionLauncher;

  const validDexConfig: LaunchConfig = {
    serial: 'R5CW10ABCDE',
    profile: 'samsung_dex',
    resolution: '1440p',
    dpi: 240,
    refreshRate: 60,
    codec: 'h264',
    audioRouting: true,
    modelName: 'Galaxy S24 Ultra',
  };

  const validMotoConfig: LaunchConfig = {
    serial: 'ZY22ABCD12',
    profile: 'motorola_ready_for',
    resolution: '1080p',
    dpi: 200,
    refreshRate: 90,
    codec: 'h265',
    audioRouting: false,
    modelName: 'Edge 50 Ultra',
  };

  const validDesktopConfig: LaunchConfig = {
    serial: 'DEV_PIXEL',
    profile: 'universal_desktop',
    resolution: '4k',
    dpi: 320,
    refreshRate: 60,
    codec: 'h264',
    audioRouting: true,
    modelName: 'Pixel 8',
  };

  const validMirrorConfig: LaunchConfig = {
    serial: 'DEV_MIRROR',
    profile: 'screen_mirror',
    resolution: 'retina_16_10',
    dpi: 240,
    refreshRate: 120,
    codec: 'h265',
    audioRouting: true,
    modelName: 'Galaxy S24 Ultra',
  };

  beforeEach(() => {
    vi.useFakeTimers();
    mockRunner = new MockScrcpyRunner();
    mockRunner.reset();
    launcher = new SessionLauncher(mockRunner, { killTimeoutMs: 2000, maxLogLines: 500 });
  });

  afterEach(() => {
    if (launcher) {
      launcher.dispose();
    }
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  describe('Suite 1: Argument Builder & Resolution Presets', () => {
    it('resolves standard resolution presets accurately', () => {
      expect(resolveResolution('1080p')).toEqual({ width: 1920, height: 1080 });
      expect(resolveResolution('1440p')).toEqual({ width: 2560, height: 1440 });
      expect(resolveResolution('4k')).toEqual({ width: 3840, height: 2160 });
      expect(resolveResolution('retina_16_10')).toEqual({ width: 2560, height: 1600 });
    });

    it('generates correct CLI flags for Samsung DeX profile', () => {
      const args = buildScrcpyArgs(validDexConfig);

      expect(args).toContain('-s');
      expect(args[args.indexOf('-s') + 1]).toBe('R5CW10ABCDE');
      expect(args).toContain('--new-display=2560x1440/240');
      expect(args).toContain('--video-codec=h264');
      expect(args).toContain('--max-fps=60');
      expect(args).toContain('--stay-awake');
      expect(args).toContain('--keyboard=uhid');
      expect(args).toContain('--mouse=uhid');
      expect(args).toContain('--audio-source=playback');
      expect(args).not.toContain('--no-audio');
      expect(args).not.toContain('--turn-screen-off');
      expect(args).toContain('DexConnect — Samsung DeX (Galaxy S24 Ultra)');

      // Critical Scrcpy 5.0.1 syntax guard: standalone --display-dpi causes fatal exit
      expect(args.some((a) => a.startsWith('--display-dpi'))).toBe(false);
      expect(args.some((a) => a.startsWith('--dpi='))).toBe(false);
    });

    it('generates correct CLI flags for Motorola Ready For profile with audio disabled', () => {
      const args = buildScrcpyArgs(validMotoConfig);

      expect(args).toContain('-s');
      expect(args[args.indexOf('-s') + 1]).toBe('ZY22ABCD12');
      expect(args).toContain('--new-display=1920x1080/200');
      expect(args).toContain('--turn-screen-off');
      expect(args).toContain('--video-codec=h265');
      expect(args).toContain('--max-fps=90');
      expect(args).toContain('--no-audio');
      expect(args).not.toContain('--audio-source=playback');
      expect(args).toContain('DexConnect — Smart Connect (Edge 50 Ultra)');
      expect(args.some((a) => a.startsWith('--display-dpi'))).toBe(false);
    });

    it('generates correct CLI flags for Universal Android Desktop profile in 4K', () => {
      const args = buildScrcpyArgs(validDesktopConfig);

      expect(args).toContain('--new-display=3840x2160/320');
      expect(args).toContain('--turn-screen-off');
      expect(args).toContain('--stay-awake');
      expect(args).toContain('--keyboard=uhid');
      expect(args).toContain('--mouse=uhid');
      expect(args).toContain('DexConnect — Android Desktop (Pixel 8)');
      expect(args.some((a) => a.startsWith('--display-dpi'))).toBe(false);
    });

    it('generates correct CLI flags for Screen Mirror profile (no virtual display)', () => {
      const args = buildScrcpyArgs(validMirrorConfig);

      expect(args).toContain('--turn-screen-off');
      expect(args).toContain('--max-size=2560');
      expect(args).toContain('--video-buffer=0');
      expect(args).toContain('--audio-buffer=20');
      expect(args).toContain('--video-codec=h265');
      expect(args).toContain('--max-fps=120');
      expect(args).toContain('DexConnect — Mirror (Galaxy S24 Ultra)');

      // Mirror profile must NOT spawn a new virtual display
      expect(args.some((a) => a.startsWith('--new-display'))).toBe(false);
    });

    it('clamps DPI defensively and handles edge cases', () => {
      expect(clampDpi(100)).toBe(120); // minimum bound
      expect(clampDpi(800)).toBe(640); // maximum bound
      expect(clampDpi(NaN, 240)).toBe(240); // fallback
      expect(clampDpi(-10, 280)).toBe(280); // negative fallback
      expect(clampDpi(219.8)).toBe(220); // rounding
    });

    it('sanitizes device model title', () => {
      expect(sanitizeTitle('  Pixel 8 Pro \n\t')).toBe('Pixel 8 Pro');
      expect(sanitizeTitle('')).toBe('Unknown Device');
      expect(sanitizeTitle(undefined)).toBe('Unknown Device');
    });

    it('validates launch configurations', () => {
      expect(validateLaunchConfig(validDexConfig).valid).toBe(true);
      expect(validateLaunchConfig({ ...validDexConfig, serial: '' }).valid).toBe(false);
      expect(validateLaunchConfig({ ...validDexConfig, profile: 'unknown' as any }).valid).toBe(false);
      expect(validateLaunchConfig(null as any).valid).toBe(false);
    });
  });

  describe('Suite 2: Session Launch & PID Supervision', () => {
    it('successfully launches session, assigns PID, and tracks active session', async () => {
      const statusEvents: ActiveSession[] = [];
      launcher.on('session-status-changed', (s) => statusEvents.push({ ...s }));

      const result = await launcher.launchSession(validDexConfig);
      expect(result.success).toBe(true);
      expect(result.sessionId).toBeTruthy();

      const activeSessions = launcher.getActiveSessions();
      expect(activeSessions).toHaveLength(1);

      const session = activeSessions[0];
      expect(session.sessionId).toBe(result.sessionId);
      expect(session.deviceSerial).toBe(validDexConfig.serial);
      expect(session.pid).toBeGreaterThan(0);
      expect(session.status).toBe('running');
      expect(session.config).toEqual(validDexConfig);
      expect(session.startedAt).toBeTruthy();

      expect(statusEvents.some((s) => s.status === 'running')).toBe(true);
      expect(mockRunner.getLastSpawnedArgs()).toContain('--new-display=2560x1440/240');
    });

    it('returns session by sessionId via getSession()', async () => {
      const result = await launcher.launchSession(validDexConfig);
      const session = launcher.getSession(result.sessionId!);
      expect(session).toBeDefined();
      expect(session?.deviceSerial).toBe(validDexConfig.serial);

      const unknown = launcher.getSession('non_existent_id');
      expect(unknown).toBeUndefined();
    });

    it('returns all sessions via getAllSessions()', async () => {
      const res = await launcher.launchSession(validDexConfig);
      expect(launcher.getAllSessions()).toHaveLength(1);
      expect(launcher.getAllSessions()[0].sessionId).toBe(res.sessionId);
    });
  });

  describe('Suite 3: Single-Session-Per-Device Rule', () => {
    it('prevents launching duplicate sessions on the same device serial', async () => {
      const res1 = await launcher.launchSession(validDexConfig);
      expect(res1.success).toBe(true);

      const res2 = await launcher.launchSession({
        ...validDexConfig,
        profile: 'screen_mirror',
      });
      expect(res2.success).toBe(false);
      expect(res2.error).toMatch(/already active/i);

      expect(launcher.getActiveSessions()).toHaveLength(1);
    });

    it('allows concurrent sessions on distinct physical devices', async () => {
      const res1 = await launcher.launchSession(validDexConfig);
      const res2 = await launcher.launchSession(validMotoConfig);

      expect(res1.success).toBe(true);
      expect(res2.success).toBe(true);

      const active = launcher.getActiveSessions();
      expect(active).toHaveLength(2);
      expect(active.map((s) => s.deviceSerial)).toContain(validDexConfig.serial);
      expect(active.map((s) => s.deviceSerial)).toContain(validMotoConfig.serial);
    });
  });

  describe('Suite 4: Graceful Termination (SIGTERM)', () => {
    it('stops active session gracefully with SIGTERM and simulated clean exit', async () => {
      const statusEvents: ActiveSession[] = [];
      launcher.on('session-status-changed', (s) => statusEvents.push({ ...s }));

      const resLaunch = await launcher.launchSession(validDexConfig);
      const sessionId = resLaunch.sessionId!;

      const resStop = await launcher.stopSession(sessionId);
      expect(resStop.success).toBe(true);

      // Verify intermediate 'stopping' status
      expect(statusEvents.some((s) => s.status === 'stopping')).toBe(true);

      // Process emits exit code 0
      await vi.advanceTimersByTimeAsync(10);

      expect(launcher.getActiveSessions()).toHaveLength(0);
      expect(statusEvents.some((s) => s.status === 'terminated')).toBe(true);

      // Device lock released: can launch again
      const resReLaunch = await launcher.launchSession(validDexConfig);
      expect(resReLaunch.success).toBe(true);
    });

    it('returns error when stopping unknown session ID', async () => {
      const res = await launcher.stopSession('unknown_session');
      expect(res.success).toBe(false);
      expect(res.error).toMatch(/not found/i);
    });

    it('is idempotent when stopping an already terminated session', async () => {
      const resLaunch = await launcher.launchSession(validDexConfig);
      const sessionId = resLaunch.sessionId!;
      await launcher.stopSession(sessionId);
      await vi.advanceTimersByTimeAsync(10);

      const secondStop = await launcher.stopSession(sessionId);
      expect(secondStop.success).toBe(true);
    });
  });

  describe('Suite 5: Escalation to SIGKILL when Process Hangs', () => {
    it('escalates to SIGKILL when process does not terminate within 2000ms', async () => {
      const resLaunch = await launcher.launchSession(validDexConfig);
      const sessionId = resLaunch.sessionId!;
      const session = launcher.getSession(sessionId)!;
      const pid = session.pid;

      // Configure mock process to ignore SIGTERM
      mockRunner.setProcessHangOnSigterm(pid, true);

      // Request stop
      const stopPromise = launcher.stopSession(sessionId);

      // Advance by 1000ms: process should still be in 'stopping' state
      await vi.advanceTimersByTimeAsync(1000);
      expect(session.status).toBe('stopping');
      expect(mockRunner.getSignalsForProcess(pid)).toEqual(['SIGTERM']);

      // Advance past 2000ms escalation threshold
      await vi.advanceTimersByTimeAsync(1100);

      // Escalation fired: SIGKILL sent
      expect(mockRunner.getSignalsForProcess(pid)).toEqual(['SIGTERM', 'SIGKILL']);

      const resStop = await stopPromise;
      expect(resStop.success).toBe(true);
      expect(launcher.getActiveSessions()).toHaveLength(0);
    });
  });

  describe('Suite 6: Ring Buffer Log Streaming', () => {
    it('captures stdout and stderr streams and emits session-log events', async () => {
      const logEvents: SessionLogEntry[] = [];
      launcher.on('session-log', (entry) => logEvents.push(entry));

      const res = await launcher.launchSession(validDexConfig);
      const sessionId = res.sessionId!;
      const session = launcher.getSession(sessionId)!;

      mockRunner.simulateOutput(session.pid, 'INFO: Display created 2560x1440', 'stdout');
      mockRunner.simulateOutput(session.pid, 'WARN: Audio packet jitter', 'stderr');

      expect(logEvents).toHaveLength(2);
      expect(logEvents[0].sessionId).toBe(sessionId);
      expect(logEvents[0].text).toContain('INFO: Display created 2560x1440');
      expect(logEvents[1].sessionId).toBe(sessionId);
      expect(logEvents[1].text).toContain('WARN: Audio packet jitter');

      const logs = launcher.getSessionLogs(sessionId);
      expect(logs).toHaveLength(2);
    });

    it('enforces ring buffer capacity limit by dropping oldest lines (FIFO)', async () => {
      // Launcher with ring buffer size of 50
      const smallLauncher = new SessionLauncher(mockRunner, { maxLogLines: 50 });
      const res = await smallLauncher.launchSession(validDexConfig);
      const sessionId = res.sessionId!;
      const session = smallLauncher.getSession(sessionId)!;

      for (let i = 0; i < 70; i++) {
        mockRunner.simulateOutput(session.pid, `Log Line ${i}`, 'stdout');
      }

      const logs = smallLauncher.getSessionLogs(sessionId);
      expect(logs).toHaveLength(50);
      expect(logs[0]).toContain('Log Line 20');
      expect(logs[49]).toContain('Log Line 69');

      smallLauncher.dispose();
    });

    it('handles StreamLineSplitter chunk fragmentation cleanly', () => {
      const lines: string[] = [];
      const splitter = new StreamLineSplitter((line) => lines.push(line));

      splitter.feed('INFO: scrcpy 5.0.1 <http');
      expect(lines).toHaveLength(0);

      splitter.feed('s://github.com/Genymobile/scrcpy>\n');
      expect(lines).toHaveLength(1);
      expect(lines[0]).toBe('INFO: scrcpy 5.0.1 <https://github.com/Genymobile/scrcpy>');

      splitter.feed('Second Line without newline');
      splitter.flush();
      expect(lines).toHaveLength(2);
      expect(lines[1]).toBe('Second Line without newline');
    });

    it('verifies RingBuffer standalone data structure properties', () => {
      const ring = new RingBuffer<string>(3);
      expect(ring.size()).toBe(0);

      ring.push('A');
      ring.push('B');
      expect(ring.toArray()).toEqual(['A', 'B']);

      ring.push('C');
      expect(ring.toArray()).toEqual(['A', 'B', 'C']);

      ring.push('D');
      expect(ring.toArray()).toEqual(['B', 'C', 'D']);

      ring.clear();
      expect(ring.size()).toBe(0);
      expect(ring.toArray()).toEqual([]);
    });
  });

  describe('Suite 7: Process Failures, Unexpected Exits & Teardown', () => {
    it('handles unexpected exit code 2 (device disconnect) with error transition', async () => {
      const statusEvents: ActiveSession[] = [];
      launcher.on('session-status-changed', (s) => statusEvents.push({ ...s }));

      const res = await launcher.launchSession(validDexConfig);
      const sessionId = res.sessionId!;
      const session = launcher.getSession(sessionId)!;

      // Simulate device disconnect mid-session (exit code 2)
      mockRunner.simulateExit(session.pid, 2);

      expect(launcher.getActiveSessions()).toHaveLength(0);
      const errorEvent = statusEvents.find((s) => s.status === 'error');
      expect(errorEvent).toBeDefined();
      expect(errorEvent?.error).toMatch(/device disconnect|exit code 2/i);

      // Device unlocked: can be launched again
      const resReLaunch = await launcher.launchSession(validDexConfig);
      expect(resReLaunch.success).toBe(true);
    });

    it('handles user closing scrcpy window (exit code 0) cleanly', async () => {
      const statusEvents: ActiveSession[] = [];
      launcher.on('session-status-changed', (s) => statusEvents.push({ ...s }));

      const res = await launcher.launchSession(validDexConfig);
      const sessionId = res.sessionId!;
      const session = launcher.getSession(sessionId)!;

      mockRunner.simulateExit(session.pid, 0);

      expect(launcher.getActiveSessions()).toHaveLength(0);
      const terminatedEvent = statusEvents.find((s) => s.status === 'terminated');
      expect(terminatedEvent).toBeDefined();
      expect(terminatedEvent?.exitCode).toBe(0);
    });

    it('dispose() terminates all running child processes immediately', async () => {
      await launcher.launchSession(validDexConfig);
      await launcher.launchSession(validMotoConfig);

      expect(mockRunner.getActivePids()).toHaveLength(2);
      expect(launcher.getActiveSessions()).toHaveLength(2);

      launcher.dispose();

      // All child handles killed
      expect(mockRunner.getActivePids()).toHaveLength(0);
      expect(launcher.getActiveSessions()).toHaveLength(0);

      // Further launches rejected
      const postDispose = await launcher.launchSession(validDexConfig);
      expect(postDispose.success).toBe(false);
      expect(postDispose.error).toMatch(/disposed/i);
    });
  });
});
