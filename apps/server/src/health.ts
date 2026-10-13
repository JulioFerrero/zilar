import { Effect } from 'effect';
import { SqlClient } from 'effect/sql';
import { minClientProtocol, protocolVersion } from '@zilar/protocol';
import type { ServerDatabase } from './db/client';
import type { EdgeHealth } from './effect/edge';
import { sqlRuntimeFor } from './effect/sql';
import { healthSnapshot, type HealthSnapshot } from './health-status';
import { serverVersion } from './version';
import type { EjabberdAdminClient } from './xmpp/admin/types';

const DB_HEALTH_TIMEOUT_MS = 1000;
const EJABBERD_HEALTH_TIMEOUT_MS = 2000;
const EJABBERD_HEALTH_CACHE_MS = 15_000;
// `userExists` is a cheap admin round trip, so any answer — true or false —
// proves ejabberd's admin API is answering. The probe JID is a fixed name.
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
  leader: boolean;
  draining: boolean;
  lastPushSentAt?: string;
  lastPushFailure?: { at: string; kind: string };
};

export type HealthCheckDeps = {
  db: ServerDatabase;
  adminClient: EjabberdAdminClient;
};

// Builds the `/health` handler. The status code reflects Postgres and the
// drain: a draining instance answers 503 with `draining: true` so Traefik drops
// it, while the process keeps serving (T-1316). The ejabberd and push fields
// are informational and never make the container unhealthy. ejabberd is probed
// at most once per `EJABBERD_HEALTH_CACHE_MS`, so Coolify's frequent healthcheck
// does not hammer the admin API.
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
  return {
    ok: dbUp && !snapshot.draining,
    name: 'zilar-server',
    version: serverVersion,
    commit: process.env.ZILAR_COMMIT ?? 'unknown',
    protocolVersion,
    minClientProtocol,
    db: dbUp ? 'ok' : 'down',
    ejabberd,
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
