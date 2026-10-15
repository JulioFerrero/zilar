// The `/me` view helpers (T-1559 size split): `meView` and its row lookup,
// moved unchanged from `api.ts`. See the header there for the route wiring.

import { Effect } from 'effect';
import { SqlClient } from 'effect/sql';
import { avatarIdsByOwner, avatarUrlFor } from '../avatars/service';
import { runSql } from '../effect/sql';
import { HttpError } from '../errors';
import { findXmppAccount } from '../xmpp/provisioning';
import type { AuthApiDependencies } from './api';
import { bioForUser } from './profile-bio';
import { timeZoneFor } from './profile-time-zone';

interface HandleLookupRow {
  handle: string;
}

interface SessionUserLookupRow {
  id: string;
  email: string;
  name: string;
  image: string | null;
  createdAt: Date;
}

export async function meView(
  deps: AuthApiDependencies,
  userId: string,
): Promise<{
  id: string;
  email: string;
  name: string;
  image: string | null;
  avatarUrl?: string;
  handle: string | null;
  createdAt: string;
  jid: string | null;
  bio?: string;
  timeZone?: string;
}> {
  const sessionUser = await sessionUserById(deps, userId);
  const account = await findXmppAccount(deps.db, userId);
  const bio = await bioForUser(deps.db, userId);
  const timeZone = await timeZoneFor(deps.db, userId);
  const [handleRow] = await runSql(
    deps.db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql<HandleLookupRow>`SELECT handle FROM handles WHERE user_id = ${userId} LIMIT 1`;
    }),
  );
  // T-0165: a stored picture wins (`/api/avatars/<id>`), otherwise the
  // existing `user.image` value is kept (Better Auth's table untouched).
  const ownAvatar = await avatarIdsByOwner(deps.db, 'user', [userId]);
  const avatarId = ownAvatar.get(userId);
  return {
    id: sessionUser.id,
    email: sessionUser.email,
    name: sessionUser.name,
    image: sessionUser.image ?? null,
    ...(avatarId === undefined ? {} : { avatarUrl: avatarUrlFor(avatarId) }),
    handle: handleRow?.handle ?? null,
    createdAt:
      sessionUser.createdAt instanceof Date
        ? sessionUser.createdAt.toISOString()
        : String(sessionUser.createdAt),
    jid: account?.jid ?? null,
    ...(bio === null ? {} : { bio }),
    ...(timeZone === null ? {} : { timeZone }),
  };
}

async function sessionUserById(
  deps: AuthApiDependencies,
  userId: string,
): Promise<{ id: string; email: string; name: string; image: string | null; createdAt: Date }> {
  // `created_at` is a timestamp WITHOUT a time zone, which the pg driver parses
  // in the process's local zone. The
  // `AT TIME ZONE 'UTC'` cast returns the same instant as a timestamptz, so
  // `/me` answers the same `createdAt` in any process time zone.
  const [sessionUser] = await runSql(
    deps.db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql<SessionUserLookupRow>`SELECT id, email, name, image, (created_at AT TIME ZONE 'UTC') AS "createdAt" FROM "user" WHERE id = ${userId} LIMIT 1`;
    }),
  );
  if (!sessionUser) {
    throw new HttpError(401, 'unauthorized', 'Authentication required');
  }
  return sessionUser;
}
