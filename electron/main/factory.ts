import {
  IAdbExecutor,
  SystemAdbExecutor,
  MockAdbExecutor,
  IScrcpyProcessRunner,
  SystemScrcpyRunner,
  MockScrcpyRunner,
} from './adapters';

export interface AppAdapters {
  adb: IAdbExecutor;
  scrcpy: IScrcpyProcessRunner;
  adbExecutor: IAdbExecutor;
  scrcpyRunner: IScrcpyProcessRunner;
  isMock: boolean;
}

let cachedAdb: IAdbExecutor | null = null;
let cachedScrcpy: IScrcpyProcessRunner | null = null;

/**
 * Determines whether mock mode is active via DEXCONNECT_MOCK or test environment
 */
export function isMockMode(): boolean {
  return process.env.DEXCONNECT_MOCK === '1' || process.env.NODE_ENV === 'test';
}

/**
 * Retrieves the application adapters, creating singletons if not already initialized
 */
export function getAdapters(): AppAdapters {
  const isMock = isMockMode();

  if (!cachedAdb) {
    cachedAdb = isMock ? new MockAdbExecutor() : new SystemAdbExecutor();
  }

  if (!cachedScrcpy) {
    cachedScrcpy = isMock ? new MockScrcpyRunner() : new SystemScrcpyRunner();
  }

  return {
    adb: cachedAdb,
    scrcpy: cachedScrcpy,
    adbExecutor: cachedAdb,
    scrcpyRunner: cachedScrcpy,
    isMock,
  };
}

/**
 * Factory function alias for getAdapters
 */
export function createAdapters(): AppAdapters {
  return getAdapters();
}

/**
 * Convenience accessor for IAdbExecutor
 */
export function getAdbExecutor(): IAdbExecutor {
  return getAdapters().adb;
}

/**
 * Convenience accessor for IScrcpyProcessRunner
 */
export function getScrcpyRunner(): IScrcpyProcessRunner {
  return getAdapters().scrcpy;
}

/**
 * Allows explicit dependency injection override (used by test suites)
 */
export function setAdbExecutor(executor: IAdbExecutor): void {
  cachedAdb = executor;
}

/**
 * Allows explicit dependency injection override (used by test suites)
 */
export function setScrcpyRunner(runner: IScrcpyProcessRunner): void {
  cachedScrcpy = runner;
}

/**
 * Resets cached adapter singletons (useful in test teardown)
 */
export function resetAdapters(): void {
  cachedAdb = null;
  cachedScrcpy = null;
}
