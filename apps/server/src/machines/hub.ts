import { TunnelServer, type KeyRegistry, type DeskServer } from '@zilar/runner-tunnel';
import { Duration, Effect, Fiber, Schedule } from 'effect';
import { type ServerDatabase } from '../db/client';
import { serializeError } from '../effect/error-utils';
import { type RunnerDesk } from '../hands/runner-hands';
import { type RoutineLogger } from '../routines/scheduler';
import { listApprovedMachineKeys } from './service';
/**
 * Binds the desk server to one runner, so a turn's `RunnerDesk` never carries
 * (or leaks) the runner id.
 */
function bindRunnerDesk(desk: DeskServer, runnerId: string): RunnerDesk {
  return {
    sendDesk: (frame) => desk.sendDesk(runnerId, frame),
    openDeskExec: (deskId) => desk.openDeskExec(runnerId, deskId),
  };
}

export interface CreateHubKeyRegistryOptions {
  db: ServerDatabase;
  registry: HubRegistrySource;
  logger: RoutineLogger;
  refreshMs?: number;
  /** Off in tests so they leak no timers; the hub sets it to true. */
  autoStartTimer?: boolean;
}

// The minimum the cache needs; tests can pass a stand-in.
export interface HubRegistrySource {
  onRevoke(listener: (machineId: string) => void): () => void;
  onApprove(listener: (machineId: string, publicKey: string) => void): () => void;
}

export interface HubMachineLookup extends HubRegistrySource {
  touchLastSeen(machineId: string, at: Date): Promise<void>;
}

// `getPublicKey` is synchronous because the tunnel re-reads it after the
// challenge to catch a mid-handshake revoke, so the cache mirrors the database
// only at refresh boundaries and at synchronous approve/revoke events.
export interface HubKeyRegistry extends KeyRegistry {
  refresh(): Promise<void>;
  close(): void;
  /** Every machine id currently in the cache (used to poll liveness). */
  approvedIds(): IterableIterator<string>;
}

export function createHubKeyRegistry({
  db,
  registry,
  logger,
  refreshMs = 30_000,
  autoStartTimer = false,
}: CreateHubKeyRegistryOptions): HubKeyRegistry {
  const keys = new Map<string, string>();
  const revokeListeners = new Set<(machineId: string) => void>();
  let refreshFiber: Fiber.Fiber<number, never> | null = null;
  // Events that land during a refresh win over its result: a machine revoked
  // mid-refresh must never come back from a stale read.
  let inFlight: { revoked: Set<string>; approved: Map<string, string> } | null = null;

  function fireRevoke(machineId: string): void {
    for (const listener of revokeListeners) {
      try {
        listener(machineId);
      } catch (error) {
        logger.warn({ err: serializeError(error), machineId }, 'revoke listener threw');
      }
    }
  }

  async function refresh(): Promise<void> {
    const events = { revoked: new Set<string>(), approved: new Map<string, string>() };
    inFlight = events;
    let next: Map<string, string>;
    try {
      const rows = await listApprovedMachineKeys(db);
      next = new Map(rows.map((row) => [row.id, row.publicKey]));
      for (const id of events.revoked) {
        next.delete(id);
      }
      for (const [id, publicKey] of events.approved) {
        next.set(id, publicKey);
      }
    } catch (error) {
      // Keep the old map: a blip must not silently authenticate the wrong set.
      logger.error({ err: serializeError(error) }, 'runner hub key refresh failed');
      return;
    } finally {
      if (inFlight === events) {
        inFlight = null;
      }
    }
    const removed: string[] = [];
    for (const id of keys.keys()) {
      if (!next.has(id)) {
        removed.push(id);
      }
    }
    keys.clear();
    for (const [id, publicKey] of next) {
      keys.set(id, publicKey);
    }
    for (const id of removed) {
      fireRevoke(id);
    }
  }

  // The first run comes after one interval, then spaced after each finish. A
  // defect outside `refresh`'s own guard is caught and logged, so the fiber
  // keeps rescheduling; `close` interrupts it.
  const refreshLoop = Effect.repeat(
    Effect.promise(() => refresh()).pipe(
      Effect.catchDefect((defect) =>
        Effect.sync(() => {
          logger.error({ err: serializeError(defect) }, 'runner hub key refresh loop failed');
        }),
      ),
    ),
    Schedule.spaced(Duration.millis(refreshMs)),
  ).pipe(Effect.delay(Duration.millis(refreshMs)));

  if (autoStartTimer) {
    refreshFiber = Effect.runFork(refreshLoop);
  }

  // The routes call `notifyApproved`/`notifyRevoked` after the commit, so the
  // cache updates in the same tick instead of waiting for a refresh; a revoke
  // then closes the live WebSocket with CLOSE_REVOKED.
  const unsubscribeDurableApprove = registry.onApprove((machineId, publicKey) => {
    inFlight?.revoked.delete(machineId);
    inFlight?.approved.set(machineId, publicKey);
    keys.set(machineId, publicKey);
  });
  const unsubscribeDurableRevoke = registry.onRevoke((machineId) => {
    inFlight?.approved.delete(machineId);
    inFlight?.revoked.add(machineId);
    if (keys.delete(machineId)) {
      fireRevoke(machineId);
    }
  });

  return {
    getPublicKey(machineId: string): string | null {
      return keys.get(machineId) ?? null;
    },

    approve(machineId: string, publicKey: string): void {
      inFlight?.revoked.delete(machineId);
      inFlight?.approved.set(machineId, publicKey);
      keys.set(machineId, publicKey);
    },

    revoke(machineId: string): void {
      inFlight?.approved.delete(machineId);
      inFlight?.revoked.add(machineId);
      if (keys.delete(machineId)) {
        fireRevoke(machineId);
      }
    },

    onRevoke(listener: (runnerId: string) => void): () => void {
      revokeListeners.add(listener);
      return () => {
        revokeListeners.delete(listener);
      };
    },

    refresh,

    approvedIds(): IterableIterator<string> {
      return keys.keys();
    },

    close(): void {
      if (refreshFiber !== null) {
        const fiber = refreshFiber;
        refreshFiber = null;
        Effect.runFork(Fiber.interrupt(fiber));
      }
      unsubscribeDurableApprove();
      unsubscribeDurableRevoke();
    },
  };
}

export interface StartRunnerHubOptions {
  db: ServerDatabase;
  registry: HubMachineLookup;
  logger: RoutineLogger;
  port: number;
  heartbeatIntervalMs?: number;
  heartbeatTimeoutMs?: number;
  handshakeTimeoutMs?: number;
  highWaterMarkBytes?: number;
  /** Refresh cadence for the approved-key cache; default 30 s. */
  refreshMs?: number;
  /** Defaults to `LAST_SEEN_MIN_INTERVAL_MS`; tests shorten it. */
  pollIntervalMs?: number;
}

export interface RunnerHub {
  isOnline(machineId: string): boolean;
  close(): Promise<void>;
  port: number;
  /** The desk ops bound to a live runner; read per turn, so a dropped runner is refused next turn. */
  deskFor(machineId: string): RunnerDesk | null;
}

// Bumps `last_seen_at` at most once a minute, so the heartbeat loop does not
// bottleneck the database; the value is only a hint for the UI.
const LAST_SEEN_MIN_INTERVAL_MS = 60_000;

export async function startRunnerHub({
  db,
  registry,
  logger,
  port,
  heartbeatIntervalMs,
  heartbeatTimeoutMs,
  handshakeTimeoutMs,
  highWaterMarkBytes,
  refreshMs = 30_000,
  pollIntervalMs = LAST_SEEN_MIN_INTERVAL_MS,
}: StartRunnerHubOptions): Promise<RunnerHub> {
  const cache = createHubKeyRegistry({
    db,
    registry,
    logger,
    refreshMs,
    autoStartTimer: true,
  });

  // Load before the tunnel starts, so the first handshake already finds every
  // approved key.
  await cache.refresh();

  const server = await TunnelServer.start(
    {
      registry: cache,
      ...(heartbeatIntervalMs === undefined ? {} : { heartbeatIntervalMs }),
      ...(heartbeatTimeoutMs === undefined ? {} : { heartbeatTimeoutMs }),
      ...(handshakeTimeoutMs === undefined ? {} : { handshakeTimeoutMs }),
      ...(highWaterMarkBytes === undefined ? {} : { highWaterMarkBytes }),
    },
    port,
  );

  const lastSeenWrites = new Map<string, number>();
  const flushLastSeen = async (machineId: string): Promise<void> => {
    const now = Date.now();
    const previous = lastSeenWrites.get(machineId) ?? 0;
    if (now - previous < LAST_SEEN_MIN_INTERVAL_MS) {
      return;
    }
    lastSeenWrites.set(machineId, now);
    try {
      await registry.touchLastSeen(machineId, new Date(now));
    } catch {
      // Log the id only, never the time or any other detail.
      logger.warn({ machineId }, 'runner hub failed to write last_seen_at');
      lastSeenWrites.delete(machineId);
    }
  };

  // The tunnel has no "became ready" event, so a poll writes `last_seen_at` for
  // the live approved ids. First run after one interval, then spaced; a defect
  // is logged so the fiber keeps rescheduling.
  async function pollOnce(): Promise<void> {
    for (const id of cache.approvedIds()) {
      if (server.isRunnerLive(id)) {
        await flushLastSeen(id);
      }
    }
  }

  const pollLoop = Effect.repeat(
    Effect.promise(() => pollOnce()).pipe(
      Effect.catchDefect((defect) =>
        Effect.sync(() => {
          logger.error({ err: serializeError(defect) }, 'runner hub last-seen poll failed');
        }),
      ),
    ),
    Schedule.spaced(Duration.millis(pollIntervalMs)),
  ).pipe(Effect.delay(Duration.millis(pollIntervalMs)));
  const pollFiber = Effect.runFork(pollLoop);

  logger.info({ port: server.port }, 'runner hub listening');

  return {
    // Read from the tunnel, so the flag is never stale and never true after a revoke.
    isOnline(machineId: string): boolean {
      return cache.getPublicKey(machineId) !== null && server.isRunnerLive(machineId);
    },

    deskFor(machineId: string): RunnerDesk | null {
      if (cache.getPublicKey(machineId) === null || !server.isRunnerLive(machineId)) {
        return null;
      }
      return bindRunnerDesk(server.desk, machineId);
    },

    async close(): Promise<void> {
      await Effect.runPromise(Fiber.interrupt(pollFiber));
      cache.close();
      await server.close().catch(() => undefined);
    },

    port: server.port,
  };
}
