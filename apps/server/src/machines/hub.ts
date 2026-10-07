import { TunnelServer } from '@zilar/runner-tunnel';
import type { KeyRegistry } from '@zilar/runner-tunnel';
import { Duration, Effect, Fiber, Schedule } from 'effect';
import { DEFAULT_LITELLM_BASE_URL } from '../ai/litellm-client';
import type { ServerDatabase } from '../db/client';
import { listApprovedMachineKeys } from './service';

export interface HubLogger {
  info: (fields: Record<string, unknown>, message: string) => void;
  warn: (fields: Record<string, unknown>, message: string) => void;
  error: (fields: Record<string, unknown>, message: string) => void;
}

export interface CreateHubKeyRegistryOptions {
  db: ServerDatabase;
  /** Source of approve/revoke events; the cache subscribes on construction. */
  registry: HubRegistrySource;
  logger: HubLogger;
  refreshMs?: number;
  /**
   * Start the periodic refresh timer on creation. Off in tests so they do
   * not leak timers between cases; the hub always sets it to true.
   */
  autoStartTimer?: boolean;
}

// The minimum surface the cache needs from the durable registry. The real
// `DbMachineRegistry` satisfies this; tests can pass a stand-in.
export interface HubRegistrySource {
  onRevoke(listener: (machineId: string) => void): () => void;
  onApprove(listener: (machineId: string, publicKey: string) => void): () => void;
}

// The minimum interface the hub needs from the durable registry at runtime.
export interface HubMachineLookup extends HubRegistrySource {
  touchLastSeen(machineId: string, at: Date): Promise<void>;
}

// The in-memory cache the tunnel speaks to. `getPublicKey` is synchronous —
// the tunnel re-reads the key after the challenge to catch a mid-handshake
// revoke — so the cache mirrors the database only at refresh boundaries and
// at synchronous approve/revoke events delivered by the durable registry.
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
  // Approve/revoke events that land while a refresh query is in flight. The
  // query may have read the database before the change committed, so the
  // events win over its result: a machine revoked mid-refresh must never come
  // back into the cache from a stale read.
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
      // A failed refresh keeps the old map; the cache survives a transient
      // database blip and we do not silently authenticate the wrong set.
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

  // The periodic refresh is one Effect program: `refresh` repeated with a
  // fixed spacing (the delay starts when the previous run finishes), with the
  // whole program delayed once so the first run comes after one interval,
  // exactly as the old `setTimeout` chain did. `refresh` catches its own
  // database errors, but anything it throws outside that guard (a listener
  // bug, say) is caught here and logged, so the fiber survives it and keeps
  // rescheduling — the old `void refresh().finally(scheduleRefresh)` chain
  // always re-armed the same way. `close` interrupts the fiber in place of
  // the old `timer`/`closed` flags.
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

  // The durable registry drives the cache synchronously: the routes call
  // `notifyApproved` / `notifyRevoked` after the DB write commits, and the
  // cache mirrors them so the tunnel sees the change in the same tick (no
  // 30 s refresh race). `cache.revoke` then fires the tunnel's `onRevoke`
  // listener, which closes the live WebSocket with CLOSE_REVOKED.
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

function serializeError(error: unknown): Record<string, unknown> {
  if (error instanceof Error) {
    return { name: error.name, message: error.message };
  }
  return { message: String(error) };
}

export interface StartRunnerHubOptions {
  db: ServerDatabase;
  registry: HubMachineLookup;
  logger: HubLogger;
  port: number;
  gatewayUrl?: string;
  heartbeatIntervalMs?: number;
  heartbeatTimeoutMs?: number;
  handshakeTimeoutMs?: number;
  highWaterMarkBytes?: number;
  /** Refresh cadence for the approved-key cache; default 30 s. */
  refreshMs?: number;
  /**
   * How often the hub polls live connections to update `last_seen_at`.
   * Defaults to `LAST_SEEN_MIN_INTERVAL_MS` (60 s). Tests shorten it so the
   * assertions do not wait a minute.
   */
  pollIntervalMs?: number;
}

export interface RunnerHub {
  isOnline(machineId: string): boolean;
  close(): Promise<void>;
  port: number;
}

// Bumps `last_seen_at` at most once every 60 s while the machine is still
// connected, so the database does not become the bottleneck of the heartbeat
// loop. The exact value is not load-bearing: it is a hint for the UI.
const LAST_SEEN_MIN_INTERVAL_MS = 60_000;

export async function startRunnerHub({
  db,
  registry,
  logger,
  port,
  gatewayUrl,
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

  // The cache loads before the tunnel starts, so the very first handshake
  // already finds an approved key for everyone who is approved right now.
  await cache.refresh();

  const resolvedGateway = gatewayUrl ?? DEFAULT_LITELLM_BASE_URL;
  if (!resolvedGateway.startsWith('http://')) {
    cache.close();
    throw new HubConfigError(
      `runner hub gateway url must be http:// (got ${scrubScheme(resolvedGateway)})`,
    );
  }

  const server = await TunnelServer.start(
    {
      registry: cache,
      gatewayUrl: resolvedGateway,
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
      // A failed write only logs the id, never the time or any other detail.
      logger.warn({ machineId }, 'runner hub failed to write last_seen_at');
      lastSeenWrites.delete(machineId);
    }
  };

  // The tunnel has no "became ready" event, so a poll walks the approved ids
  // and writes `last_seen_at` for the live ones (throttled per machine). Like
  // the key refresh, the loop is one Effect program: the first run after one
  // interval, then every `pollIntervalMs` after the previous run finished.
  // `flushLastSeen` catches its own write errors, but anything else the walk
  // throws is caught here and logged so the fiber survives it and reschedules,
  // as the old `void pollOnce().finally(schedulePoll)` chain did. `close`
  // interrupts the fiber in place of the old `timer`/`stopped` flags.
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
    // Read straight from the tunnel so the flag is never stale, and never
    // true for a machine whose key has just been revoked.
    isOnline(machineId: string): boolean {
      return cache.getPublicKey(machineId) !== null && server.isRunnerLive(machineId);
    },

    async close(): Promise<void> {
      await Effect.runPromise(Fiber.interrupt(pollFiber));
      cache.close();
      await server.close().catch(() => undefined);
    },

    port: server.port,
  };
}

export class HubConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'HubConfigError';
  }
}

// Some misconfiguration is fatal at startup. Validate the gateway URL the
// same way the tunnel does, so the failure is named rather than a ZodError
// from inside `TunnelServer.start`.
export function assertRunnerHubConfig(options: { enabled: boolean; gatewayUrl: string }): void {
  if (!options.enabled) {
    return;
  }
  if (!options.gatewayUrl.startsWith('http://')) {
    throw new HubConfigError(
      `RUNNER_HUB_ENABLED requires an http:// gateway url (got ${scrubScheme(options.gatewayUrl)})`,
    );
  }
}

// Replace any non-http scheme with a redacted placeholder, so the error
// message can be logged without echoing the whole URL.
function scrubScheme(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.protocol}//<redacted>`;
  } catch {
    return 'invalid-url';
  }
}
