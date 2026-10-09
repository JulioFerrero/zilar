// T-0690: a better-auth database adapter over `effect/sql`, replacing
// `drizzleAdapter` once the production switch lands. It runs on the same
// `SqlClient` the rest of the server uses (`sqlRuntimeFor(db)`), so it works
// against Postgres and PGlite with no new dependency. The production switch
// in `auth.ts` is a later task; this module is built and tested on its own.
//
// better-auth hands the custom adapter canonical camelCase field names and
// expects canonical camelCase rows back. The SQL client camelCases result
// column names (`snakeToCamel`), and the field map below covers the four auth
// tables' snake_case columns, so no other layer needs to know the difference.

import { Effect } from 'effect';
import { SqlClient, SqlError, Statement } from 'effect/sql';
import { createAdapterFactory } from 'better-auth/adapters';
import type {
  AdapterFactoryConfig,
  AdapterFactoryCustomizeAdapterCreator,
  CleanedWhere,
  CustomAdapter,
} from 'better-auth/adapters';
import type { BetterAuthOptions, DBAdapter } from 'better-auth';
import type { ServerDatabase } from '../db/client';
import { sqlRuntimeFor } from '../effect/sql';

const TABLES = ['user', 'session', 'account', 'verification'] as const;
type AuthTable = (typeof TABLES)[number];

// Fields whose snake_case column differs from the canonical better-auth name.
// A field absent here is stored under its own name (id, name, email, token,
// identifier, value, scope, password, image).
const FIELD_NAMES: Record<AuthTable, Record<string, string>> = {
  user: {
    emailVerified: 'email_verified',
    createdAt: 'created_at',
    updatedAt: 'updated_at',
  },
  session: {
    expiresAt: 'expires_at',
    createdAt: 'created_at',
    updatedAt: 'updated_at',
    ipAddress: 'ip_address',
    userAgent: 'user_agent',
    userId: 'user_id',
  },
  account: {
    accountId: 'account_id',
    providerId: 'provider_id',
    userId: 'user_id',
    accessToken: 'access_token',
    refreshToken: 'refresh_token',
    idToken: 'id_token',
    accessTokenExpiresAt: 'access_token_expires_at',
    refreshTokenExpiresAt: 'refresh_token_expires_at',
    createdAt: 'created_at',
    updatedAt: 'updated_at',
  },
  verification: {
    expiresAt: 'expires_at',
    createdAt: 'created_at',
    updatedAt: 'updated_at',
  },
};

function tableFor(model: string): AuthTable {
  if ((TABLES as readonly string[]).includes(model)) {
    return model as AuthTable;
  }
  throw new Error(`Unknown better-auth model: ${model}`);
}

function columnFor(model: string, field: string): string {
  return FIELD_NAMES[tableFor(model)][field] ?? field;
}

function toColumns(model: string, data: Record<string, unknown>): Record<string, unknown> {
  const row: Record<string, unknown> = {};
  for (const [field, value] of Object.entries(data)) {
    row[columnFor(model, field)] = value;
  }
  return row;
}

// A literal substring search, like the memory adapter: escape the LIKE
// wildcards so a `%` or `_` in the value matches itself.
function likePattern(kind: 'contains' | 'starts_with' | 'ends_with', value: unknown): string {
  const escaped = String(value).replace(/[\\%_]/g, (char) => `\\${char}`);
  if (kind === 'starts_with') return `${escaped}%`;
  if (kind === 'ends_with') return `%${escaped}`;
  return `%${escaped}%`;
}

function clauseFragment(
  sql: Statement.Constructor,
  model: string,
  clause: CleanedWhere,
): Statement.Fragment {
  const columnName = columnFor(model, clause.field);
  const column = sql(columnName);
  const { value } = clause;
  const list = Array.isArray(value) ? value : [value];
  switch (clause.operator) {
    case 'in':
      return sql`${sql.in(columnName, list)}`;
    case 'not_in':
      return sql`${column} NOT IN ${sql.in(list)}`;
    case 'ne':
      return value === null ? sql`${column} IS NOT NULL` : sql`${column} <> ${value}`;
    case 'lt':
      return sql`${column} < ${value}`;
    case 'lte':
      return sql`${column} <= ${value}`;
    case 'gt':
      return sql`${column} > ${value}`;
    case 'gte':
      return sql`${column} >= ${value}`;
    case 'contains':
    case 'starts_with':
    case 'ends_with': {
      const operator = clause.mode === 'insensitive' ? 'ILIKE' : 'LIKE';
      return sql`${column} ${sql.literal(operator)} ${likePattern(
        clause.operator,
        value,
      )} ESCAPE '\\'`;
    }
    default:
      return value === null ? sql`${column} IS NULL` : sql`${column} = ${value}`;
  }
}

// The where clauses fold left to right: each clause's connector links it to the
// running result, matching how the memory adapter evaluates them.
function whereFragment(
  sql: Statement.Constructor,
  model: string,
  where: ReadonlyArray<CleanedWhere> | undefined,
): Statement.Fragment | null {
  if (!where || where.length === 0) {
    return null;
  }
  let combined = clauseFragment(sql, model, where[0] as CleanedWhere);
  for (let index = 1; index < where.length; index += 1) {
    const clause = where[index] as CleanedWhere;
    const connector = clause.connector === 'OR' ? ' OR ' : ' AND ';
    combined = sql`(${combined})${sql.literal(connector)}(${clauseFragment(sql, model, clause)})`;
  }
  return combined;
}

function run<A>(
  db: ServerDatabase,
  effect: Effect.Effect<A, SqlError.SqlError, SqlClient.SqlClient>,
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
// the instant from the local components so the round trip preserves the value,
// the way drizzle's `+0000` parse does. On a UTC host this is the identity.
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

function normalizeRow(config: AdapterConfig, model: string, row: Row): Row {
  const fields = config.schema[config.getDefaultModelName(model)]?.fields ?? {};
  for (const [field, value] of Object.entries(row)) {
    if (value instanceof Date && fields[field]?.type === 'date') {
      row[field] = utcTimestamp(value);
    }
  }
  return row;
}

function makeAdapter(db: ServerDatabase, config: AdapterConfig): CustomAdapter {
  async function create({ model, data }: CreateArgs): Promise<Row> {
    const row = toColumns(model, data);
    // `session.updated_at` and `account.updated_at` have no database default;
    // drizzle fills them from `$onUpdate` on insert, so the adapter must too.
    if (row.updated_at === undefined) {
      row.updated_at = new Date();
    }
    const rows = await run(
      db,
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        return yield* sql<Row>`INSERT INTO ${sql(tableFor(model))} ${sql.insert(row)} RETURNING *`;
      }),
    );
    const created = rows[0];
    return created === undefined ? row : normalizeRow(config, model, created);
  }

  async function findOne({ model, where }: FindOneArgs): Promise<Row | null> {
    const rows = await run(
      db,
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        const clause = whereFragment(sql, model, where);
        if (clause === null) {
          return [];
        }
        return yield* sql<Row>`SELECT * FROM ${sql(tableFor(model))} WHERE ${clause} LIMIT 1`;
      }),
    );
    const found = rows[0];
    return found === undefined ? null : normalizeRow(config, model, found);
  }

  async function findMany({ model, where, limit, offset, sortBy }: FindManyArgs): Promise<Row[]> {
    const rows = await run(
      db,
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        const clause = whereFragment(sql, model, where);
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
    return rows.map((row) => normalizeRow(config, model, row));
  }

  async function count({ model, where }: CountArgs): Promise<number> {
    return run(
      db,
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        const clause = whereFragment(sql, model, where);
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
        const clause = whereFragment(sql, model, where);
        if (clause === null) {
          return [];
        }
        return yield* sql<Row>`UPDATE ${sql(tableFor(model))} SET ${sql.update(
          row,
        )} WHERE ${clause} RETURNING *`;
      }),
    );
    const updated = rows[0];
    return updated === undefined ? null : normalizeRow(config, model, updated);
  }

  async function updateMany({ model, where, update: values }: UpdateArgs): Promise<number> {
    const row = toColumns(model, values);
    return run(
      db,
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        const clause = whereFragment(sql, model, where);
        if (clause === null) {
          return 0;
        }
        const rows = yield* sql<{ id: string }>`UPDATE ${sql(tableFor(model))} SET ${sql.update(
          row,
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
        const clause = whereFragment(sql, model, where);
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
        const clause = whereFragment(sql, model, where);
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
    makeAdapter(db, adapterConfig);

  return createAdapterFactory({ config, adapter });
}
