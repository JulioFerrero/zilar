// T-0690: the better-auth database adapter over `effect/sql`, used by `auth.ts`.
// It runs on the same `SqlClient` the rest of the server uses (`sqlRuntimeFor(db)`),
// so it works against Postgres and PGlite with no new dependency.
//
// better-auth hands the custom adapter canonical camelCase field names and
// expects canonical camelCase rows back. The SQL client camelCases result
// column names (`snakeToCamel`), and the field map in `sql-where.ts` covers the
// four auth tables' snake_case columns, so no other layer needs to know the
// difference.

import { Effect } from 'effect';
import { PgTypes } from '@effect/sql-pg';
import { SqlClient } from 'effect/sql';
import { APIError } from 'better-auth/api';
import { createAdapterFactory } from 'better-auth/adapters';
import type {
  AdapterFactoryConfig,
  AdapterFactoryCustomizeAdapterCreator,
  CleanedWhere,
  CustomAdapter,
} from 'better-auth/adapters';
import type { BetterAuthOptions, DBAdapter } from 'better-auth';
import type { ServerDatabase } from '../db/client';
import { isPgliteDatabase, sqlRuntimeFor } from '../effect/sql';
import { consumeInviteEffect } from './invites';
import { columnFor, tableFor, toColumns, whereFragment } from './sql-where';

function run<A, E>(
  db: ServerDatabase,
  effect: Effect.Effect<A, E, SqlClient.SqlClient>,
): Promise<A> {
  return sqlRuntimeFor(db).runPromise(effect);
}

type Row = Record<string, unknown>;
type AdapterConfig = Parameters<AdapterFactoryCustomizeAdapterCreator>[0];
type CreateArgs = { model: string; data: Row };
type FindOneArgs = { model: string; where: CleanedWhere[] };
type FindManyArgs = {
  model: string;
  where?: CleanedWhere[] | undefined;
  limit: number;
  offset?: number | undefined;
  sortBy?: { field: string; direction: 'asc' | 'desc' } | undefined;
};
type CountArgs = { model: string; where?: CleanedWhere[] | undefined };
type UpdateArgs = { model: string; where: CleanedWhere[]; update: Row };
type DeleteArgs = { model: string; where: CleanedWhere[] };

// The auth tables' timestamps are `timestamp` (no time zone). The PGlite driver
// writes a `Date` as its UTC wall clock but reads it back as local time; rebuild
// the instant from the local components so the round trip preserves the value.
// On a UTC host this is the identity.
// Real pg needs no rebuild: its `timestamp` codec already maps the wall-clock
// fields to the UTC fields of the `Date` (@effect/sql-pg 4.0.2,
// dist/PgTypes.js:23-27), so `normalizeRow` leaves those rows unchanged.
function utcTimestamp(value: Date): Date {
  return new Date(
    Date.UTC(
      value.getFullYear(),
      value.getMonth(),
      value.getDate(),
      value.getHours(),
      value.getMinutes(),
      value.getSeconds(),
      value.getMilliseconds(),
    ),
  );
}

function normalizeRow(db: ServerDatabase, config: AdapterConfig, model: string, row: Row): Row {
  if (!isPgliteDatabase(db)) {
    return row;
  }
  const fields = config.schema[config.getDefaultModelName(model)]?.fields ?? {};
  for (const [field, value] of Object.entries(row)) {
    if (value instanceof Date && fields[field]?.type === 'date') {
      row[field] = utcTimestamp(value);
    }
  }
  return row;
}

// On real pg a `Date` binds as `timestamptz`, and a `timestamp` column stores it
// as wall clock in the session `TimeZone`. `PgTypes.timestamp` binds the UTC
// fields instead, so the stored wall clock is UTC whatever the session is. PGlite
// keeps the plain `Date` binding it has always had. Written values and where
// values bind the same way, so a comparison sees the stored wall clock.
export function bindValue(db: ServerDatabase, value: unknown): unknown {
  return !isPgliteDatabase(db) && value instanceof Date ? PgTypes.timestamp(value) : value;
}

function bindRow(db: ServerDatabase, row: Row): Row {
  const bound: Row = {};
  for (const [column, value] of Object.entries(row)) {
    bound[column] = bindValue(db, value);
  }
  return bound;
}

function makeAdapter(
  db: ServerDatabase,
  config: AdapterConfig,
  pendingInviteCodes: Map<string, string>,
): CustomAdapter {
  async function create({ model, data }: CreateArgs): Promise<Row> {
    // T-1286 (SG-9): a sign-up's `create.before` hook records the invite code
    // under the user's email. When present, the invite is consumed and the row
    // inserted in ONE transaction: a failed insert rolls the use back, and two
    // racing sign-ups serialize on the invite row, so the cap is never
    // exceeded. Reading and clearing the entry is the per-request hand-off.
    const email = model === 'user' && typeof data.email === 'string' ? data.email : undefined;
    const inviteCode = email === undefined ? undefined : pendingInviteCodes.get(email);
    if (email !== undefined) {
      pendingInviteCodes.delete(email);
    }
    const row = toColumns(model, data);
    // `session.updated_at` and `account.updated_at` have no database default;
    // The adapter fills them on insert.
    if (row.updated_at === undefined) {
      row.updated_at = new Date();
    }
    const rows = await run(
      db,
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        const insert = () =>
          sql<Row>`INSERT INTO ${sql(tableFor(model))} ${sql.insert(bindRow(db, row))} RETURNING *`;
        if (inviteCode === undefined) {
          return yield* insert();
        }
        return yield* sql.withTransaction(
          Effect.gen(function* () {
            const consumed = yield* consumeInviteEffect(inviteCode);
            if (consumed === null) {
              return yield* Effect.fail(
                new APIError('BAD_REQUEST', {
                  message: 'This invite is invalid, expired or already used.',
                }),
              );
            }
            return yield* insert();
          }),
        );
      }),
    );
    const created = rows[0];
    return created === undefined ? row : normalizeRow(db, config, model, created);
  }

  async function findOne({ model, where }: FindOneArgs): Promise<Row | null> {
    const rows = await run(
      db,
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        const clause = whereFragment(db, sql, model, where);
        if (clause === null) {
          return [];
        }
        return yield* sql<Row>`SELECT * FROM ${sql(tableFor(model))} WHERE ${clause} LIMIT 1`;
      }),
    );
    const found = rows[0];
    return found === undefined ? null : normalizeRow(db, config, model, found);
  }

  async function findMany({ model, where, limit, offset, sortBy }: FindManyArgs): Promise<Row[]> {
    const rows = await run(
      db,
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        const clause = whereFragment(db, sql, model, where);
        const order =
          sortBy === undefined
            ? sql.literal('')
            : sql` ORDER BY ${sql(columnFor(model, sortBy.field))}${
                sortBy.direction === 'desc' ? sql.literal(' DESC') : sql.literal(' ASC')
              }`;
        const pagination =
          offset === undefined ? sql` LIMIT ${limit}` : sql` LIMIT ${limit} OFFSET ${offset}`;
        if (clause === null) {
          return yield* sql<Row>`SELECT * FROM ${sql(tableFor(model))}${order}${pagination}`;
        }
        return yield* sql<Row>`SELECT * FROM ${sql(tableFor(model))} WHERE ${clause}${order}${pagination}`;
      }),
    );
    return rows.map((row) => normalizeRow(db, config, model, row));
  }

  async function count({ model, where }: CountArgs): Promise<number> {
    return run(
      db,
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        const clause = whereFragment(db, sql, model, where);
        if (clause === null) {
          const rows = yield* sql<{ total: number }>`SELECT count(*)::int AS total FROM ${sql(
            tableFor(model),
          )}`;
          return rows[0]?.total ?? 0;
        }
        const rows = yield* sql<{ total: number }>`SELECT count(*)::int AS total FROM ${sql(
          tableFor(model),
        )} WHERE ${clause}`;
        return rows[0]?.total ?? 0;
      }),
    );
  }

  async function update({ model, where, update: values }: UpdateArgs): Promise<Row | null> {
    const row = toColumns(model, values);
    const rows = await run(
      db,
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        const clause = whereFragment(db, sql, model, where);
        if (clause === null) {
          return [];
        }
        return yield* sql<Row>`UPDATE ${sql(tableFor(model))} SET ${sql.update(
          bindRow(db, row),
        )} WHERE ${clause} RETURNING *`;
      }),
    );
    const updated = rows[0];
    return updated === undefined ? null : normalizeRow(db, config, model, updated);
  }

  async function updateMany({ model, where, update: values }: UpdateArgs): Promise<number> {
    const row = toColumns(model, values);
    return run(
      db,
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        const clause = whereFragment(db, sql, model, where);
        if (clause === null) {
          return 0;
        }
        const rows = yield* sql<{ id: string }>`UPDATE ${sql(tableFor(model))} SET ${sql.update(
          bindRow(db, row),
        )} WHERE ${clause} RETURNING id`;
        return rows.length;
      }),
    );
  }

  async function remove({ model, where }: DeleteArgs): Promise<void> {
    await run(
      db,
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        const clause = whereFragment(db, sql, model, where);
        if (clause === null) {
          return;
        }
        yield* sql`DELETE FROM ${sql(tableFor(model))} WHERE ${clause}`;
      }),
    );
  }

  async function deleteMany({ model, where }: DeleteArgs): Promise<number> {
    return run(
      db,
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        const clause = whereFragment(db, sql, model, where);
        if (clause === null) {
          return 0;
        }
        const rows = yield* sql<{ id: string }>`DELETE FROM ${sql(
          tableFor(model),
        )} WHERE ${clause} RETURNING id`;
        return rows.length;
      }),
    );
  }

  // The handler signatures are narrower than the generic `CustomAdapter` ones
  // (the lib types each method as returning the caller's `T`); the cast keeps
  // the concrete row types we actually produce.
  return {
    create,
    findOne,
    findMany,
    count,
    update,
    updateMany,
    delete: remove,
    deleteMany,
  } as unknown as CustomAdapter;
}

export function effectSqlAdapter(
  db: ServerDatabase,
  pendingInviteCodes: Map<string, string>,
): (options: BetterAuthOptions) => DBAdapter<BetterAuthOptions> {
  const config: AdapterFactoryConfig = {
    adapterId: 'effect-sql',
    adapterName: 'Effect SQL Adapter',
    usePlural: false,
    supportsJSON: true,
    supportsDates: true,
    supportsBooleans: true,
    transaction: false,
  };

  const adapter: AdapterFactoryCustomizeAdapterCreator = (adapterConfig) =>
    makeAdapter(db, adapterConfig, pendingInviteCodes);

  return createAdapterFactory({ config, adapter });
}
