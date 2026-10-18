import { Effect } from 'effect';
import { SqlClient } from 'effect/sql';
import { minClientProtocol, protocolVersion } from '@zilar/protocol';
import type { ServerDatabase } from './db/client';
import type { EdgeHealth } from './effect/edge';
import { sqlRuntimeFor } from './effect/sql';
import { healthSnapshot, type HealthSnapshot } from './health-status';
import { serverVersion } from './version';
import type { EjabberdAdminClient } from './xmpp/admin/types';
import { ejabberdSchemaStatus, type EjabberdSchemaStatus } from './xmpp/schema-check';

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
