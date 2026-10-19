// effect-plain: a Postgres advisory-lock leader election; the reserved `postgres`
// connection and its polling timer are inherently async/sessionful.
//
// One dedicated session-level advisory lock decides which of the two overlapping
// instances during a rolling deploy runs the leader-only work (`leader/start.ts`).
// Session locks release when the connection closes, so a killed container hands over
// with no cleanup.
import postgres from 'postgres';
import type { Logger } from 'pino';
import { messageOf } from '../effect/error-utils';

// A dedicated advisory-lock scope, so this never collides with the per-key
// `pg_advisory_xact_lock(hashtext(…))` locks already in the database.
export const LEADER_LOCK_SCOPE = 730034;
export const LEADER_LOCK_KEY = 1;
export const LEADER_POLL_MS = 1000;

// The lock surface `createLeaderLock` needs. Tests use a fake, because the PGlite test
// database is one in-process handle the `postgres` TCP client cannot connect to.
export interface LeaderLockConnection {
  tryLock(): Promise<boolean>;
  unlock(): Promise<void>;
  close(): Promise<void>;
  onError(listener: (error: unknown) => void): void;
}

export interface CreateLeaderLockOptions {
  connection: LeaderLockConnection;
  logger: Pick<Logger, 'info' | 'error'>;
  onAcquire: () => Promise<void>;
  onStepDown: () => Promise<void>;
  pollMs?: number;
  exit?: (code: number) => void;
}

export interface LeaderLock {
  start: () => void;
  isLeader: () => boolean;
  stepDown: () => Promise<void>;
  close: () => Promise<void>;
}

export function createLeaderLock(options: CreateLeaderLockOptions): LeaderLock {
  const pollMs = options.pollMs ?? LEADER_POLL_MS;
  const exit = options.exit ?? ((code: number) => process.exit(code));
  let leader = false;
  let stopped = false;
  let timer: NodeJS.Timeout | null = null;
  let inFlight: Promise<void> | null = null;

  const stopPolling = (): void => {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
  };

  // A failure after the lock is held leaves the process leaderless, so it logs and exits;
  // `restart: unless-stopped` brings it back as a follower.
  const fail = (error: unknown, message: string): void => {
    if (stopped) {
      return;
    }
    stopped = true;
    stopPolling();
    options.logger.error({ err: messageOf(error) }, message);
    exit(1);
  };

  options.connection.onError((error) => {
    if (leader) {
      fail(error, 'leader lock connection lost; exiting');
    }
  });

  const schedule = (): void => {
    if (stopped || leader || timer !== null) {
      return;
    }
    timer = setTimeout(() => {
      timer = null;
      void attempt();
    }, pollMs);
    timer.unref();
  };

  async function attempt(): Promise<void> {
    if (stopped || leader) {
      return;
    }
    let locked: boolean;
    try {
      locked = await options.connection.tryLock();
    } catch (error) {
      options.logger.error({ err: messageOf(error) }, 'leader lock acquire failed; retrying');
      schedule();
      return;
    }
    if (stopped) {
      return;
    }
    if (!locked) {
      schedule();
      return;
    }
    try {
      await options.onAcquire();
    } catch (error) {
      fail(error, 'leader work failed to start; exiting');
      return;
    }
    if (stopped) {
      // Shutdown arrived while acquiring; give the lock straight back.
      await options.connection.unlock().catch(() => undefined);
      return;
    }
    leader = true;
    options.logger.info('leader acquired');
  }

  return {
    start(): void {
      if (stopped) {
        return;
      }
      inFlight = attempt();
    },
    isLeader(): boolean {
      return leader;
    },
    async stepDown(): Promise<void> {
      if (stopped) {
        return;
      }
      stopped = true;
      stopPolling();
      if (inFlight !== null) {
        await inFlight;
        inFlight = null;
      }
      if (!leader) {
        return;
      }
      leader = false;
      try {
        await options.onStepDown();
      } finally {
        try {
          await options.connection.unlock();
        } catch (error) {
          options.logger.error({ err: messageOf(error) }, 'leader lock release failed');
        }
        options.logger.info('leader stepped down');
      }
    },
    async close(): Promise<void> {
      if (stopped) {
        stopPolling();
      }
      stopped = true;
      await options.connection.close();
    },
  };
}

// Runs `pg_try_advisory_lock` on one reserved connection, so the session that takes the
// lock is the one that releases it.
export function createPostgresLockConnection(options: {
  url: string;
  scope: number;
  key: number;
}): LeaderLockConnection {
  let closing = false;
  let reserved: postgres.ReservedSql | null = null;
  const errorListeners: Array<(error: unknown) => void> = [];
  const sql = postgres(options.url, {
    max: 1,
    onclose: () => {
      if (closing) {
        return;
      }
      for (const listener of errorListeners) {
        listener(new Error('leader lock connection closed'));
      }
    },
  });

  const reservedConnection = async (): Promise<postgres.ReservedSql> => {
    if (reserved === null) {
      reserved = await sql.reserve();
    }
    return reserved;
  };

  return {
    async tryLock(): Promise<boolean> {
      const connection = await reservedConnection();
      const rows = await connection<
        { locked: boolean }[]
      >`select pg_try_advisory_lock(${options.scope}, ${options.key}) as locked`;
      return rows[0]?.locked === true;
    },
    async unlock(): Promise<void> {
      if (reserved === null) {
        return;
      }
      await reserved`select pg_advisory_unlock(${options.scope}, ${options.key})`;
    },
    async close(): Promise<void> {
      closing = true;
      if (reserved !== null) {
        reserved.release();
        reserved = null;
      }
      await sql.end({ timeout: 5 });
    },
    onError(listener): void {
      errorListeners.push(listener);
    },
  };
}
