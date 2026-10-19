import { Effect } from 'effect';
import { SqlClient } from 'effect/sql';
import { minClientProtocol, protocolVersion } from '@zilar/protocol';
import type { ServerDatabase } from './db/client';
import type { EdgeHealth } from './effect/edge';
import { sqlRuntimeFor } from './effect/sql';
import { serverVersion } from './version';
import type { EjabberdAdminClient } from './xmpp/admin/types';
import { ejabberdSchemaStatus, type EjabberdSchemaStatus } from './xmpp/schema-check';

export type PushStatus = 'online' | 'offline' | 'unknown';

export type PushFailureKind = 'send-failed' | 'archive-unavailable';

export type HealthSnapshot = {
  push: PushStatus;
  leader: boolean;
  /** True from SIGTERM until the process closes. */
  draining: boolean;
  lastPushSentAt?: string;
  lastPushFailure?: { at: string; kind: PushFailureKind };
};

type PushState = {
  status: PushStatus;
  // The failure reason stays out of `healthSnapshot()`: the public `/health` route
  // serialises it, and it must never leak internal error text.
  offlineReason?: string;
  lastPushSentAt?: string;
  lastPushFailure?: { at: string; kind: PushFailureKind };
};

// Process-wide push and leader liveness, read by the `/health` builder. It holds no
// secrets: a status, an ISO timestamp, a failure kind and the drain flags.
let state: PushState = { status: 'unknown' };

let leader = false;
let draining = false;

export function markLeader(value: boolean): void {
  leader = value;
}

// Called once at shutdown so `/health` answers 503 while the process drains.
export function markDraining(): void {
  draining = true;
}

export function markPushOnline(): void {
  state = { ...state, status: 'online' };
}

export function markPushOffline(reason: string): void {
  state = { ...state, status: 'offline', offlineReason: reason };
}

export function markPushSent(): void {
  state = { ...state, lastPushSentAt: new Date().toISOString() };
}

export function markPushFailed(kind: PushFailureKind): void {
  state = { ...state, lastPushFailure: { at: new Date().toISOString(), kind } };
}

export function healthSnapshot(): HealthSnapshot {
  return {
    push: state.status,
    leader,
    draining,
    ...(state.lastPushSentAt === undefined ? {} : { lastPushSentAt: state.lastPushSentAt }),
    ...(state.lastPushFailure === undefined ? {} : { lastPushFailure: state.lastPushFailure }),
  };
}

const DB_HEALTH_TIMEOUT_MS = 1000;
const EJABBERD_HEALTH_TIMEOUT_MS = 2000;
const EJABBERD_HEALTH_CACHE_MS = 15_000;
// Any answer, true or false, proves ejabberd's admin API is answering; the probe JID is fixed.
const EJABBERD_HEALTH_PROBE = 'zilar-health-probe';

export type HealthBody = {
  ok: boolean;
  name: string;
  version: string;
  commit: string;
  protocolVersion: string;
  minClientProtocol: string;
  db: 'ok' | 'down';
  ejabberd: 'ok' | 'down';
  push: 'online' | 'offline' | 'unknown';
  /** The startup schema check's result; absent without a pool. */
  ejabberdSchema?: EjabberdSchemaStatus;
  leader: boolean;
  draining: boolean;
  lastPushSentAt?: string;
  lastPushFailure?: { at: string; kind: string };
};

export type HealthCheckDeps = {
  db: ServerDatabase;
  adminClient: EjabberdAdminClient;
};

// The status code reflects Postgres and draining: a draining instance answers 503 so
// Traefik drops it while it keeps serving. ejabberd, push and schema are informational
// and never make it unhealthy; ejabberd is probed at most once per `EJABBERD_HEALTH_CACHE_MS`.
export function createHealthCheck(deps: HealthCheckDeps): () => Promise<EdgeHealth> {
  let ejabberd: { at: number; status: 'ok' | 'down' } | undefined;

  const ejabberdStatus = async (): Promise<'ok' | 'down'> => {
    const at = Date.now();
    if (ejabberd !== undefined && at - ejabberd.at < EJABBERD_HEALTH_CACHE_MS) {
      return ejabberd.status;
    }
    const status: 'ok' | 'down' = await probeEjabberd(deps.adminClient);
    ejabberd = { at, status };
    return status;
  };

  return async () => {
    const [dbUp, ejabberdValue] = await Promise.all([isDatabaseUp(deps.db), ejabberdStatus()]);
    const snapshot = healthSnapshot();
    return {
      status: dbUp && !snapshot.draining ? 200 : 503,
      body: healthBody(dbUp, ejabberdValue, snapshot),
    };
  };
}

async function probeEjabberd(adminClient: EjabberdAdminClient): Promise<'ok' | 'down'> {
  try {
    await withTimeout(adminClient.userExists(EJABBERD_HEALTH_PROBE), EJABBERD_HEALTH_TIMEOUT_MS);
    return 'ok';
  } catch {
    return 'down';
  }
}

function healthBody(dbUp: boolean, ejabberd: 'ok' | 'down', snapshot: HealthSnapshot): HealthBody {
  const ejabberdSchema = ejabberdSchemaStatus();
  return {
    ok: dbUp && !snapshot.draining,
    name: 'zilar-server',
    version: serverVersion,
    commit: process.env.ZILAR_COMMIT ?? 'unknown',
    protocolVersion,
    minClientProtocol,
    db: dbUp ? 'ok' : 'down',
    ejabberd,
    ...(ejabberdSchema === undefined ? {} : { ejabberdSchema }),
    ...snapshot,
  };
}

async function isDatabaseUp(db: ServerDatabase): Promise<boolean> {
  try {
    await withTimeout(
      sqlRuntimeFor(db).runPromise(
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient;
          yield* sql`select 1`;
        }),
      ),
      DB_HEALTH_TIMEOUT_MS,
    );
    return true;
  } catch {
    return false;
  }
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('health check timed out')), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}
