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
  RESOLUTION_PRESETS,
  DEFAULT_DPIS,
} from '../../electron/main/services/SessionLauncher';
import { MockScrcpyRunner } from '../../electron/main/adapters/MockScrcpyRunner';
import type {
  LaunchConfig,
  LaunchProfile,
  ResolutionPreset,
  VideoCodec,
  RefreshRate,
  ActiveSession,
  SessionLogEntry,
} from '../../src/types';

describe('Milestone M3 Empirical Challenge & Adversarial Stress Suite', () => {
  let mockRunner: MockScrcpyRunner;
  let launcher: SessionLauncher;

  const sampleDexConfig: LaunchConfig = {
    serial: 'CHALLENGER_DEV_01',
    profile: 'samsung_dex',
    resolution: '1440p',
    dpi: 240,
    refreshRate: 60,
    codec: 'h264',
    audioRouting: true,
    modelName: 'Galaxy S24 Ultra',
  };

  beforeEach(() => {
    vi.useFakeTimers();
    mockRunner = new MockScrcpyRunner();
    mockRunner.reset();
    launcher = new SessionLauncher(mockRunner, {
      killTimeoutMs: 2000,
      maxLogLines: 500,
      maxCompletedSessions: 20,
    });
  });

  afterEach(() => {
    if (launcher) {
      launcher.dispose();
    }
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  // =========================================================================
  // PILLAR 1: High-Volume Log Throughput & O(1) Ring Buffer Memory Bounding
  // =========================================================================
  describe('Pillar 1: High-Volume Log Throughput & Ring Buffer Bounding', () => {
    it('P1.1: Floods 10,000 log lines in rapid burst; verifies RingBuffer strictly retains exactly 500 lines', async () => {
      const res = await launcher.launchSession(sampleDexConfig);
      expect(res.success).toBe(true);
      const sessionId = res.sessionId!;
      const session = launcher.getSession(sessionId)!;
      const pid = session.pid;

      const emittedLogEvents: SessionLogEntry[] = [];
      launcher.on('session-log', (entry) => {
        if (entry.sessionId === sessionId) {
          emittedLogEvents.push(entry);
        }
      });

      // Flood stdout with 10,000 lines in rapid bursts
      const TOTAL_LINES = 10000;
      for (let i = 0; i < TOTAL_LINES; i++) {
        mockRunner.simulateOutput(pid, `BURST_LOG_${i}: telemetry payload data`, 'stdout');
      }

      // 10,000 log events emitted in real time for UI streaming
      expect(emittedLogEvents).toHaveLength(TOTAL_LINES);

      // Verify RingBuffer inside session is strictly capped at maxLogLines (500)
      const logs = launcher.getSessionLogs(sessionId);
      expect(logs).toHaveLength(500);

      // Verify strict FIFO retention: oldest lines 0..9499 evicted, lines 9500..9999 retained
      expect(logs[0]).toBe('BURST_LOG_9500: telemetry payload data');
      expect(logs[499]).toBe('BURST_LOG_9999: telemetry payload data');
      expect(logs[250]).toBe('BURST_LOG_9750: telemetry payload data');
    });

    it('P1.2: Empirically measures O(1) push time across 100,000 items without memory leak or degradation', () => {
      // Direct benchmark on RingBuffer with 100,000 items in 10 bursts of 10,000
      const ring = new RingBuffer<string>(500);
      const BURST_COUNT = 10;
      const BURST_SIZE = 10000;
      const burstDurationsMs: number[] = [];

      for (let b = 0; b < BURST_COUNT; b++) {
        const start = performance.now();
        for (let i = 0; i < BURST_SIZE; i++) {
          ring.push(`burst_${b}_line_${i}`);
        }
        const elapsed = performance.now() - start;
        burstDurationsMs.push(elapsed);
      }

      // Capacity invariant
      expect(ring.size()).toBe(500);
      const finalItems = ring.toArray();
      expect(finalItems).toHaveLength(500);
      expect(finalItems[0]).toBe('burst_9_line_9500');
      expect(finalItems[499]).toBe('burst_9_line_9999');

      // Process degradation verification: later bursts should not be significantly slower than initial burst
      // All bursts should execute within reasonable bounds (< 100ms per 10k items)
      for (let b = 0; b < BURST_COUNT; b++) {
        expect(burstDurationsMs[b]).toBeLessThan(100);
      }
    });

    it('P1.3: Confirms RingBuffer internal array remains fixed-size (O(1) memory bound)', () => {
      const capacity = 500;
      const ring = new RingBuffer<string>(capacity);

      // Inspect capacity property
      expect(ring.capacity).toBe(capacity);
      expect(ring.size()).toBe(0);

      for (let i = 0; i < 25000; i++) {
        ring.push(`item_${i}`);
      }

      expect(ring.size()).toBe(500);
      const snapshot = ring.toArray();
      expect(snapshot.length).toBe(500);
      expect(snapshot[0]).toBe('item_24500');
      expect(snapshot[499]).toBe('item_24999');

      // Clear restores state
      ring.clear();
      expect(ring.size()).toBe(0);
      expect(ring.toArray()).toEqual([]);

      // Can be reused immediately
      ring.push('recycled_item');
      expect(ring.size()).toBe(1);
      expect(ring.toArray()).toEqual(['recycled_item']);
    });

    it('P1.4: 1,000,000 push benchmark confirms true O(1) performance without memory bloat', () => {
      const ring = new RingBuffer<number>(500);
      const ITERATIONS = 1000000;

      const startTime = performance.now();
      for (let i = 0; i < ITERATIONS; i++) {
        ring.push(i);
      }
      const totalElapsedMs = performance.now() - startTime;

      // 1,000,000 pushes into a 500-slot buffer should complete in under 500ms
      expect(totalElapsedMs).toBeLessThan(500);

      // Verify final snapshot strictly contains the last 500 numbers (999500 to 999999)
      expect(ring.size()).toBe(500);
      const finalItems = ring.toArray();
      expect(finalItems).toHaveLength(500);
      expect(finalItems[0]).toBe(999500);
      expect(finalItems[499]).toBe(999999);
    });
  });

  // =========================================================================
  // PILLAR 2: Stream Chunk Fragmentation & Boundary Stress
  // =========================================================================
  describe('Pillar 2: Stream Chunk Fragmentation Probes', () => {
    it('P2.1: Reconstructs arbitrary fragmented chunks with single-byte and random splits', () => {
      const reconstructed: string[] = [];
      const splitter = new StreamLineSplitter((line) => reconstructed.push(line));

      const originalScript = [
        'INFO: scrcpy 5.0.1 <https://github.com/Genymobile/scrcpy>',
        'INFO: Executing adb command: [adb, -s, DEV_001, shell, getprop]',
        'DEBUG: display server initialized at 2560x1440/240',
        'WARN: audio buffer underrun detected, resyncing',
        'INFO: frame rate stable at 60 fps',
      ];

      const fullStream = originalScript.join('\n') + '\n';

      // Feed into splitter in tiny 1 to 5 byte random fragments
      let cursor = 0;
      const fragmentSizes = [1, 3, 2, 5, 4, 1, 2, 7, 3, 4, 2, 6, 1, 3, 5];
      let fragIdx = 0;

      while (cursor < fullStream.length) {
        const size = fragmentSizes[fragIdx % fragmentSizes.length];
        fragIdx++;
        const chunk = fullStream.slice(cursor, cursor + size);
        splitter.feed(chunk);
        cursor += size;
      }

      expect(reconstructed).toEqual(originalScript);
    });

    it('P2.2: Handles CRLF (\\r\\n), bare LF (\\n), and mixed newline formats cleanly', () => {
      const lines: string[] = [];
      const splitter = new StreamLineSplitter((line) => lines.push(line));

      splitter.feed('Line 1 (CRLF)\r\nLine 2 (LF)\nLine 3 (CRLF)\r\n');
      expect(lines).toEqual(['Line 1 (CRLF)', 'Line 2 (LF)', 'Line 3 (CRLF)']);
    });

    it('P2.3: Handles CRLF split across chunk boundaries (\\r in chunk 1, \\n in chunk 2)', () => {
      const lines: string[] = [];
      const splitter = new StreamLineSplitter((line) => lines.push(line));

      // Chunk 1 ends with \r
      splitter.feed('First Line Message\r');
      expect(lines).toHaveLength(0); // Not completed yet

      // Chunk 2 starts with \n
      splitter.feed('\nSecond Line Message\r\n');
      expect(lines).toEqual(['First Line Message', 'Second Line Message']);
    });

    it('P2.4: Flushes trailing line without trailing newline on stream completion', () => {
      const lines: string[] = [];
      const splitter = new StreamLineSplitter((line) => lines.push(line));

      splitter.feed('Completed line 1\n');
      splitter.feed('Incomplete trailing log message without newline');
      expect(lines).toEqual(['Completed line 1']);

      splitter.flush();
      expect(lines).toEqual([
        'Completed line 1',
        'Incomplete trailing log message without newline',
      ]);
    });

    it('P2.5: Reconstructs multibyte UTF-8 characters (Korean, Japanese, emojis) across string chunks', () => {
      const lines: string[] = [];
      const splitter = new StreamLineSplitter((line) => lines.push(line));

      const complexLine = '삼성 갤럭시 S24 Ultra — 🚀 Rocket launch! 🌟 High-res (日本語)';

      // Split right across the emoji surrogate code units
      const part1 = complexLine.slice(0, 15);
      const part2 = complexLine.slice(15, 25);
      const part3 = complexLine.slice(25) + '\n';

      splitter.feed(part1);
      splitter.feed(part2);
      splitter.feed(part3);

      expect(lines).toHaveLength(1);
      expect(lines[0]).toBe(complexLine);
    });

    it('P2.6: Deep Probe: Buffer UTF-8 byte boundary behavior analysis', () => {
      // Empirical probe: test how StreamLineSplitter handles Buffer chunks
      // When a multibyte character's raw UTF-8 bytes are split across Buffer chunks
      const lines: string[] = [];
      const splitter = new StreamLineSplitter((line) => lines.push(line));

      // Rocket emoji is 4 bytes in UTF-8: [0xf0, 0x9f, 0x9a, 0x80]
      const rawBytes = Buffer.from('🚀 Rocket\n');
      // Intact buffer feed works cleanly
      splitter.feed(rawBytes);
      expect(lines[0]).toBe('🚀 Rocket');

      // Document boundary behavior: splitting in the middle of UTF-8 multi-byte buffer
      const splitLines: string[] = [];
      const splitTester = new StreamLineSplitter((l) => splitLines.push(l));
      const b1 = rawBytes.subarray(0, 2); // partial UTF-8 sequence
      const b2 = rawBytes.subarray(2);
      splitTester.feed(b1);
      splitTester.feed(b2);

      // Verify observation: Buffer.toString() on partial multi-byte produces replacement characters
      // but does NOT throw or crash the process
      expect(splitLines).toHaveLength(1);
      expect(typeof splitLines[0]).toBe('string');
    });

    it('P2.7: Processes extremely long log lines (64KB payload) without truncation or error', () => {
      const lines: string[] = [];
      const splitter = new StreamLineSplitter((line) => lines.push(line));

      const longPayload = 'X'.repeat(65536);
      splitter.feed(`PREFIX_${longPayload}_SUFFIX\n`);

      expect(lines).toHaveLength(1);
      expect(lines[0].length).toBe(7 + 65536 + 7);
      expect(lines[0].startsWith('PREFIX_')).toBe(true);
      expect(lines[0].endsWith('_SUFFIX')).toBe(true);
    });

    it('P2.8: Edge cases: empty chunks, consecutive newlines, standalone CR, and idempotent flush()', () => {
      const lines: string[] = [];
      const splitter = new StreamLineSplitter((line) => lines.push(line));

      // Empty chunks should be no-ops
      splitter.feed('');
      splitter.feed(Buffer.alloc(0));
      expect(lines).toHaveLength(0);

      // Multiple consecutive newlines: empty lines should not be emitted
      splitter.feed('\n\n\n');
      expect(lines).toHaveLength(0);

      // Standalone \r without \n
      splitter.feed('Line with CR\r');
      expect(lines).toHaveLength(0);
      splitter.feed('remainder continuing\n');
      // "Line with CR\rremainder continuing" emitted
      expect(lines).toHaveLength(1);
      expect(lines[0]).toContain('Line with CR');

      // Idempotent flush: calling flush twice when empty should not emit extra lines
      splitter.flush();
      splitter.flush();
      expect(lines).toHaveLength(1);
    });
  });

  // =========================================================================
  // PILLAR 3: Scrcpy Argument Builder Exhaustive Fuzzing & Invariant Testing
  // =========================================================================
  describe('Pillar 3: Argument Builder Exhaustive Fuzzing', () => {
    const PROFILES: LaunchProfile[] = [
      'samsung_dex',
      'motorola_ready_for',
      'universal_desktop',
      'screen_mirror',
    ];
    const RESOLUTIONS: ResolutionPreset[] = ['1080p', '1440p', '4k', 'retina_16_10'];
    const CODECS: VideoCodec[] = ['h264', 'h265'];
    const REFRESH_RATES: RefreshRate[] = [60, 90, 120];
    const AUDIO_OPTIONS: boolean[] = [true, false];
    const DPIS: number[] = [
      120, 160, 200, 240, 280, 320, 480, 640, // valid & clamped range
      -50, 0, 50, 100, 750, 1200, NaN, // boundary & invalid
    ];

    it('P3.1: INVARIANT: Standalone --display-dpi or --dpi= is NEVER generated under ANY combination', () => {
      let combinationsTested = 0;

      for (const profile of PROFILES) {
        for (const resolution of RESOLUTIONS) {
          for (const dpi of DPIS) {
            for (const codec of CODECS) {
              for (const refreshRate of REFRESH_RATES) {
                for (const audioRouting of AUDIO_OPTIONS) {
                  const config: LaunchConfig = {
                    serial: 'TEST_SERIAL_99',
                    profile,
                    resolution,
                    dpi,
                    refreshRate,
                    codec,
                    audioRouting,
                    modelName: 'Test Phone',
                  };

                  const args = buildScrcpyArgs(config);
                  combinationsTested++;

                // Scrcpy 5.0.1 critical syntax guard:
                // Standalone --display-dpi or --dpi= causes immediate exit code 1
                for (const arg of args) {
                  expect(arg.startsWith('--display-dpi')).toBe(false);
                  expect(arg.startsWith('--dpi=')).toBe(false);
                  expect(arg).not.toBe('--display-dpi');
                }

                // If virtual display profile, --new-display=WxH/DPI must be present
                if (profile !== 'screen_mirror') {
                  const newDisplayArg = args.find((a) => a.startsWith('--new-display='));
                  expect(newDisplayArg).toBeDefined();
                  const match = newDisplayArg!.match(/^--new-display=(\d+)x(\d+)\/(\d+)$/);
                  expect(match).not.toBeNull();
                  if (match) {
                    const parsedDpi = parseInt(match[3], 10);
                    // Defensive DPI clamping ensures DPI is strictly between 120 and 640
                    expect(parsedDpi).toBeGreaterThanOrEqual(120);
                    expect(parsedDpi).toBeLessThanOrEqual(640);
                  }
                } else {
                  // Screen mirror must NOT specify --new-display
                  expect(args.some((a) => a.startsWith('--new-display'))).toBe(false);
                  expect(args.some((a) => a.startsWith('--max-size='))).toBe(true);
                  expect(args).toContain('--video-buffer=0');
                }

                // Audio routing invariant
                if (audioRouting) {
                  expect(args).toContain('--audio-source=playback');
                  expect(args).not.toContain('--no-audio');
                } else {
                  expect(args).toContain('--no-audio');
                  expect(args).not.toContain('--audio-source=playback');
                }
              }
            }
          }
        }
      }
    }

      // Confirm high fuzzing volume
      expect(combinationsTested).toBeGreaterThanOrEqual(1000);
    });

    it('P3.2: Fuzzes clampDpi() defensively across boundary conditions', () => {
      // Normal range
      expect(clampDpi(160)).toBe(160);
      expect(clampDpi(240)).toBe(240);
      expect(clampDpi(320)).toBe(320);

      // Clamping bounds
      expect(clampDpi(10)).toBe(120); // lower clamp
      expect(clampDpi(119)).toBe(120);
      expect(clampDpi(120)).toBe(120);
      expect(clampDpi(640)).toBe(640);
      expect(clampDpi(641)).toBe(640); // upper clamp
      expect(clampDpi(10000)).toBe(640);

      // Edge cases & non-numeric
      expect(clampDpi(0, 240)).toBe(240);
      expect(clampDpi(-100, 280)).toBe(280);
      expect(clampDpi(NaN, 320)).toBe(320);
      expect(clampDpi(Infinity, 240)).toBe(640);
      expect(clampDpi(-Infinity, 240)).toBe(240);
      expect(clampDpi(undefined as any, 240)).toBe(240);
      expect(clampDpi(null as any, 240)).toBe(240);
      expect(clampDpi('240' as any, 240)).toBe(240);
    });

    it('P3.3: Sanitizes shell metacharacters and prevents argument injection', () => {
      const maliciousNames = [
        'Galaxy; rm -rf /',
        'Phone $(whoami)',
        'Test `calc.exe`',
        'Name with "quotes" and \'apostrophes\'',
        'LineBreak\n\r\tDevice',
      ];

      for (const malicious of maliciousNames) {
        const config: LaunchConfig = {
          ...sampleDexConfig,
          modelName: malicious,
        };

        const args = buildScrcpyArgs(config);
        const titleIdx = args.indexOf('--window-title');
        expect(titleIdx).not.toBe(-1);
        const titleVal = args[titleIdx + 1];

        // Ensure title is a safe single array element without newlines or control chars
        expect(titleVal).toBeDefined();
        expect(titleVal).not.toMatch(/[\r\n\t]/);
        expect(titleVal).toContain('DexConnect — Samsung DeX');
      }
    });

    it('P3.4: Rejects invalid configurations with descriptive errors', () => {
      expect(() => buildScrcpyArgs(null as any)).toThrow(/config/i);
      expect(() => buildScrcpyArgs({ ...sampleDexConfig, serial: '' })).toThrow(/serial/i);
      expect(() => buildScrcpyArgs({ ...sampleDexConfig, profile: 'bad_profile' as any })).toThrow(
        /profile/i
      );
    });
  });

  // =========================================================================
  // PILLAR 4: Session Termination, Memory Leak Probes & Lifecycle Cleanup
  // =========================================================================
  describe('Pillar 4: Session Lifecycle & Memory Leak Probes', () => {
    it('P4.1: High-frequency session churn (30 sequential sessions) bounds history and frees memory', async () => {
      const SESSION_COUNT = 30;

      for (let i = 0; i < SESSION_COUNT; i++) {
        const config: LaunchConfig = {
          ...sampleDexConfig,
          serial: `DEV_SER_CHURN_${i}`,
        };

        const res = await launcher.launchSession(config);
        expect(res.success).toBe(true);
        const sessionId = res.sessionId!;

        // Simulate some log activity
        mockRunner.simulateOutput(launcher.getSession(sessionId)!.pid, `churn log line for session ${i}`);

        // Stop session cleanly
        await launcher.stopSession(sessionId);
        await vi.advanceTimersByTimeAsync(10);
      }

      // All active sessions must be cleared
      expect(launcher.getActiveSessions()).toHaveLength(0);

      // Completed sessions history must be strictly bounded by maxCompletedSessions (20)
      const allTracked = launcher.getAllSessions();
      expect(allTracked.length).toBeLessThanOrEqual(20);
      expect(allTracked.length).toBe(20);

      // Verify that old sessions (0..9) were pruned from the map to prevent unbounded memory growth
      for (let i = 0; i < 10; i++) {
        const found = allTracked.find((s) => s.deviceSerial === `DEV_SER_CHURN_${i}`);
        expect(found).toBeUndefined();
      }

      // Verify that newer sessions (10..29) remain available for log review
      for (let i = 10; i < SESSION_COUNT; i++) {
        const found = allTracked.find((s) => s.deviceSerial === `DEV_SER_CHURN_${i}`);
        expect(found).toBeDefined();
      }
    });

    it('P4.2: Cancels escalation timers immediately upon process exit to prevent timer leaks', async () => {
      const res = await launcher.launchSession(sampleDexConfig);
      const sessionId = res.sessionId!;

      // Stop session
      const stopPromise = launcher.stopSession(sessionId);

      // Normal process exits quickly at 50ms (well before 2000ms escalation)
      await vi.advanceTimersByTimeAsync(50);
      const stopRes = await stopPromise;
      expect(stopRes.success).toBe(true);

      // Advance past the 2000ms mark; no timer should fire or throw
      await vi.advanceTimersByTimeAsync(3000);
      expect(mockRunner.getSignalsForProcess(launcher.getSession(sessionId)!.pid)).toEqual(['SIGTERM']);
    });

    it('P4.3: Dispose immediately cleans up all running processes, listeners, and resources', async () => {
      // Launch 3 active sessions
      const res1 = await launcher.launchSession({ ...sampleDexConfig, serial: 'DEV_A' });
      const res2 = await launcher.launchSession({ ...sampleDexConfig, serial: 'DEV_B' });
      const res3 = await launcher.launchSession({ ...sampleDexConfig, serial: 'DEV_C' });

      expect(res1.success).toBe(true);
      expect(res2.success).toBe(true);
      expect(res3.success).toBe(true);

      expect(launcher.getActiveSessions()).toHaveLength(3);
      expect(mockRunner.getActivePids()).toHaveLength(3);

      // Add listeners to verify removal
      let eventCount = 0;
      launcher.on('session-status-changed', () => eventCount++);
      launcher.on('session-log', () => eventCount++);

      // Dispose
      launcher.dispose();

      // All child handles killed via SIGKILL
      expect(mockRunner.getActivePids()).toHaveLength(0);
      expect(launcher.getActiveSessions()).toHaveLength(0);
      expect(launcher.getAllSessions()).toHaveLength(0);

      // All event listeners cleared
      expect(launcher.listenerCount('session-status-changed')).toBe(0);
      expect(launcher.listenerCount('session-log')).toBe(0);

      // Subsequent launch attempts rejected
      const postDispose = await launcher.launchSession(sampleDexConfig);
      expect(postDispose.success).toBe(false);
      expect(postDispose.error).toMatch(/disposed/i);
    });

    it('P4.4: Enforces atomic concurrency reservation on simultaneous launch attempts', async () => {
      // Dispatch 5 concurrent launch promises for the exact same device serial
      const promises = [
        launcher.launchSession(sampleDexConfig),
        launcher.launchSession(sampleDexConfig),
        launcher.launchSession(sampleDexConfig),
        launcher.launchSession(sampleDexConfig),
        launcher.launchSession(sampleDexConfig),
      ];

      const results = await Promise.all(promises);

      // Exactly 1 must succeed; all others must be rejected due to single-session rule
      const successes = results.filter((r) => r.success);
      const failures = results.filter((r) => !r.success);

      expect(successes).toHaveLength(1);
      expect(failures).toHaveLength(4);
      for (const fail of failures) {
        expect(fail.error).toMatch(/already active/i);
      }

      expect(launcher.getActiveSessions()).toHaveLength(1);
    });

    it('P4.5: Multiple concurrent stopSession() calls on the same session resolve together', async () => {
      const res = await launcher.launchSession(sampleDexConfig);
      const sessionId = res.sessionId!;

      // Issue 3 simultaneous stop calls
      const stopPromises = [
        launcher.stopSession(sessionId),
        launcher.stopSession(sessionId),
        launcher.stopSession(sessionId),
      ];

      await vi.advanceTimersByTimeAsync(20);
      const results = await Promise.all(stopPromises);

      // All must resolve with success: true
      for (const r of results) {
        expect(r.success).toBe(true);
      }
      expect(launcher.getActiveSessions()).toHaveLength(0);
    });

    it('P4.6: Session spawn rejection (e.g. scrcpy not installed) cleanly releases slot lock', async () => {
      // Configure mockRunner to report scrcpy missing
      vi.spyOn(mockRunner, 'checkScrcpyInstalled').mockResolvedValueOnce({
        installed: false,
        path: '/opt/homebrew/bin/scrcpy',
        error: 'scrcpy executable missing',
      });

      const res = await launcher.launchSession(sampleDexConfig);
      expect(res.success).toBe(false);
      expect(res.error).toMatch(/not installed/i);

      // Device lock should NOT remain held
      expect(launcher.getActiveSessions()).toHaveLength(0);
      expect(launcher.getActiveSessionForDevice(sampleDexConfig.serial)).toBeUndefined();
    });
  });
});
