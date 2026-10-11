// The auth tables' column maps and the where-clause builders of the better-auth
// SQL adapter, kept apart from `sql-adapter.ts`.
import { Statement } from 'effect/sql';
import type { CleanedWhere } from 'better-auth/adapters';
import type { ServerDatabase } from '../db/client';
import { bindValue } from './sql-adapter';

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

export function tableFor(model: string): AuthTable {
  if ((TABLES as readonly string[]).includes(model)) {
    return model as AuthTable;
  }
  throw new Error(`Unknown better-auth model: ${model}`);
}

export function columnFor(model: string, field: string): string {
  return FIELD_NAMES[tableFor(model)][field] ?? field;
}

export function toColumns(model: string, data: Record<string, unknown>): Record<string, unknown> {
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
  db: ServerDatabase,
  sql: Statement.Constructor,
  model: string,
  clause: CleanedWhere,
): Statement.Fragment {
  const columnName = columnFor(model, clause.field);
  const column = sql(columnName);
  const { value } = clause;
  const list = (Array.isArray(value) ? value : [value]).map((item) => bindValue(db, item));
  const bound = bindValue(db, value);
  switch (clause.operator) {
    case 'in':
      return sql`${sql.in(columnName, list)}`;
    case 'not_in':
      return sql`${column} NOT IN ${sql.in(list)}`;
    case 'ne':
      return value === null ? sql`${column} IS NOT NULL` : sql`${column} <> ${bound}`;
    case 'lt':
      return sql`${column} < ${bound}`;
    case 'lte':
      return sql`${column} <= ${bound}`;
    case 'gt':
      return sql`${column} > ${bound}`;
    case 'gte':
      return sql`${column} >= ${bound}`;
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
      return value === null ? sql`${column} IS NULL` : sql`${column} = ${bound}`;
  }
}

// The where clauses fold left to right: each clause's connector links it to the
// running result, matching how the memory adapter evaluates them.
export function whereFragment(
  db: ServerDatabase,
  sql: Statement.Constructor,
  model: string,
  where: ReadonlyArray<CleanedWhere> | undefined,
): Statement.Fragment | null {
  if (!where || where.length === 0) {
    return null;
  }
  let combined = clauseFragment(db, sql, model, where[0] as CleanedWhere);
  for (let index = 1; index < where.length; index += 1) {
    const clause = where[index] as CleanedWhere;
    const connector = clause.connector === 'OR' ? ' OR ' : ' AND ';
    combined = sql`(${combined})${sql.literal(connector)}(${clauseFragment(db, sql, model, clause)})`;
  }
  return combined;
}
