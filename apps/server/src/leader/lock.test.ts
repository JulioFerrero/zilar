import { describe, expect, it } from 'vitest';
import { createLeaderLock, type LeaderLockConnection } from './lock';

// A fake advisory lock shared by two connections, because the server test
// database is PGlite (`apps/server/src/test-global-setup.ts`): one in-process
// handle, not a TCP server the `postgres` client can reach, so the real
// `createPostgresLockConnection` cannot be exercised here. The fake keeps the
// same contract: the first session to try holds the lock until it releases it.
function createFakeLockBackend(): () => LeaderLockConnection {
  let held = false;
  return () => ({
    tryLock: async () => {
      if (held) {
        return false;
      }
      held = true;
      return true;
    },
    unlock: async () => {
      held = false;
    },
    close: async () => {},
    onError: () => {},
  });
}

const silentLogger = { info: () => undefined, error: () => undefined };

async function waitFor(predicate: () => boolean, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() > deadline) {
      throw new Error('timed out waiting for the condition');
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

describe('leader lock', () => {
  it('lets only one instance lead and hands over after step down', async () => {
    const connection = createFakeLockBackend();
    const acquired: string[] = [];
    const first = createLeaderLock({
      connection: connection(),
      logger: silentLogger,
      onAcquire: async () => {
        acquired.push('first');
      },
      onStepDown: async () => {
        acquired.push('first-down');
      },
    });
    const second = createLeaderLock({
      connection: connection(),
      logger: silentLogger,
      onAcquire: async () => {
        acquired.push('second');
      },
      onStepDown: async () => {
        acquired.push('second-down');
      },
    });

    first.start();
    await waitFor(() => first.isLeader(), 500);

    second.start();
    // Longer than the fast path would take: the loser keeps polling without
    // acquiring while the holder keeps the lock.
    await new Promise((resolve) => setTimeout(resolve, 80));
    expect(first.isLeader()).toBe(true);
    expect(second.isLeader()).toBe(false);
    expect(acquired).toEqual(['first']);

    await first.stepDown();
    // The loser polls every `LEADER_POLL_MS` (1000 ms), so it takes over
    // within about 1.5 s.
    await waitFor(() => second.isLeader(), 1500);
    expect(acquired).toEqual(['first', 'first-down', 'second']);

    await first.close();
    await second.close();
  });
});
