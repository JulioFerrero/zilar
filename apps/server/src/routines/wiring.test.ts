import { describe, expect, it, vi } from 'vitest';
import { buildRoutineScheduler } from './wiring';

function silentLogger() {
  return { warn: vi.fn(), error: vi.fn() };
}

describe('buildRoutineScheduler', () => {
  it('returns null silently when ROUTINES_ENABLED is false', () => {
    const logger = silentLogger();
    const handle = buildRoutineScheduler({
      db: {} as never,
      routinesEnabled: false,
      toolRunner: () => Promise.reject(new Error('must not be called')),
      post: () => Promise.resolve(true),
      audit: { record: () => Promise.resolve() },
      logger,
    });
    expect(handle).toBeNull();
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('returns null with one warning when enabled but no runner is configured', () => {
    const logger = silentLogger();
    const handle = buildRoutineScheduler({
      db: {} as never,
      routinesEnabled: true,
      post: () => Promise.resolve(true),
      audit: { record: () => Promise.resolve() },
      logger,
    });
    expect(handle).toBeNull();
    expect(logger.warn).toHaveBeenCalledTimes(1);
  });

  it('starts the scheduler when enabled with a runner', () => {
    const logger = silentLogger();
    const handle = buildRoutineScheduler({
      db: {} as never,
      routinesEnabled: true,
      toolRunner: () => Promise.reject(new Error('must not be called')),
      post: () => Promise.resolve(true),
      audit: { record: () => Promise.resolve() },
      logger,
    });
    expect(handle).not.toBeNull();
    handle?.stop();
    expect(logger.warn).not.toHaveBeenCalled();
  });
});
