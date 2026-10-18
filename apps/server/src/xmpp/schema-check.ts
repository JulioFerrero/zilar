import { Effect } from 'effect';
import type { Logger } from 'pino';
import type { ArchivePool } from '../search/service';

// ejabberd's tables live outside our migrations, so at startup the server reads
// the real shapes and compares them, so drift shows in `/health` instead of
// breaking push silently.
//
// `pg_catalog`, not `information_schema`: the read-only role has SELECT on
// `archive` only, so the latter would hide two of the tables.
export type EjabberdSchemaStatus = 'ok' | 'drift' | 'unknown';

export const EJABBERD_EXPECTED_COLUMNS: Record<string, readonly string[]> = {
  archive: [
    'username text',
    'timestamp bigint',
    'peer text',
    'bare_peer text',
    'xml text',
    'txt text',
    'id bigint',
    'kind text',
    'nick text',
    'origin_id text',
    'created_at timestamp without time zone',
  ],
  muc_room: ['name text', 'host text', 'opts text', 'created_at timestamp without time zone'],
  push_session: ['username text', 'timestamp bigint', 'service text', 'node text', 'xml text'],
};

// `format_type` renders the spellings `CREATE TABLE` takes, and
// `current_schema()` keeps another schema's same-named table out.
const COLUMNS_SQL = `
  select c.relname as table_name,
         a.attname as column_name,
         format_type(a.atttypid, a.atttypmod) as data_type
    from pg_catalog.pg_attribute a
    join pg_catalog.pg_class c on c.oid = a.attrelid
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
   where c.relname in ('archive', 'muc_room', 'push_session')
     and n.nspname = current_schema()
     and a.attnum > 0
     and not a.attisdropped
   order by c.relname, a.attnum
`;

type SchemaColumnRow = {
  table_name: string;
  column_name: string;
  data_type: string;
};

let cached: EjabberdSchemaStatus | undefined;

/**
 * A missing, extra or retyped column is `drift`; a query that cannot run is
 * `unknown`.
 */
export async function checkEjabberdSchema(
  pool: ArchivePool,
  logger?: Logger,
): Promise<EjabberdSchemaStatus> {
  const rows = await Effect.runPromise(
    Effect.tryPromise({
      try: () => pool.query(COLUMNS_SQL, []) as unknown as Promise<SchemaColumnRow[]>,
      catch: (error) => error,
    }).pipe(Effect.orElseSucceed((): SchemaColumnRow[] | null => null)),
  );
  if (rows === null) {
    logger?.warn('ejabberd schema check failed; reporting unknown');
    return 'unknown';
  }

  const found = new Map<string, Set<string>>();
  for (const table of Object.keys(EJABBERD_EXPECTED_COLUMNS)) {
    found.set(table, new Set());
  }
  for (const row of rows) {
    found.get(row.table_name)?.add(`${row.column_name} ${row.data_type}`);
  }

  // Table and column names only: never the pool's connection details.
  const drifted: { table: string; columns: string[] }[] = [];
  for (const [table, expected] of Object.entries(EJABBERD_EXPECTED_COLUMNS)) {
    const expectedPairs = new Set(expected);
    const actualPairs = found.get(table) ?? new Set<string>();
    const columns = new Set<string>();
    for (const pair of expectedPairs) {
      if (!actualPairs.has(pair)) columns.add(columnName(pair));
    }
    for (const pair of actualPairs) {
      if (!expectedPairs.has(pair)) columns.add(columnName(pair));
    }
    if (columns.size > 0) {
      drifted.push({ table, columns: [...columns] });
    }
  }

  if (drifted.length === 0) {
    return 'ok';
  }
  logger?.error(
    {
      tables: drifted.map((entry) => entry.table),
      columns: drifted.flatMap((entry) => entry.columns),
    },
    'ejabberd schema drift: table columns do not match the committed shape',
  );
  return 'drift';
}

/**
 * Runs once at startup and caches the result for `/health`; returns the pool
 * unchanged for the caller's single expression.
 */
export function startEjabberdSchemaCheck(pool: ArchivePool, logger: Logger): ArchivePool {
  cached = 'unknown';
  void checkEjabberdSchema(pool, logger).then((status) => {
    cached = status;
  });
  return pool;
}

export function ejabberdSchemaStatus(): EjabberdSchemaStatus | undefined {
  return cached;
}

function columnName(pair: string): string {
  return pair.slice(0, pair.indexOf(' '));
}
