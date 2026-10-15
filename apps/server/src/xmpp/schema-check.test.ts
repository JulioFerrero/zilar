import { describe, expect, it } from 'vitest';
import type { ArchivePool } from '../search/service';
import { checkEjabberdSchema } from './schema-check';

type Row = { table_name: string; column_name: string; data_type: string };
type Shapes = Record<string, readonly (readonly [string, string])[]>;

// The shapes the lead read on production on 2026-10-15. Kept literal so the
// `ok` test also fails if EJABBERD_EXPECTED_COLUMNS ever drifts from them.
const PRODUCTION_SHAPES: Shapes = {
  archive: [
    ['username', 'text'],
    ['timestamp', 'bigint'],
    ['peer', 'text'],
    ['bare_peer', 'text'],
    ['xml', 'text'],
    ['txt', 'text'],
    ['id', 'bigint'],
    ['kind', 'text'],
    ['nick', 'text'],
    ['origin_id', 'text'],
    ['created_at', 'timestamp without time zone'],
  ],
  muc_room: [
    ['name', 'text'],
    ['host', 'text'],
    ['opts', 'text'],
    ['created_at', 'timestamp without time zone'],
  ],
  push_session: [
    ['username', 'text'],
    ['timestamp', 'bigint'],
    ['service', 'text'],
    ['node', 'text'],
    ['xml', 'text'],
  ],
};

function rowsFor(shapes: Shapes): Row[] {
  return Object.entries(shapes).flatMap(([table_name, columns]) =>
    columns.map(([column_name, data_type]) => ({ table_name, column_name, data_type })),
  );
}

function fakePool(rows: Row[]): ArchivePool {
  return {
    query: (async () => rows) as unknown as ArchivePool['query'],
    close: () => Promise.resolve(),
  };
}

function failingPool(): ArchivePool {
  return {
    query: (async () => {
      throw new Error('connection refused');
    }) as unknown as ArchivePool['query'],
    close: () => Promise.resolve(),
  };
}

describe('checkEjabberdSchema', () => {
  it('reports ok when the three tables match the committed shape', async () => {
    await expect(checkEjabberdSchema(fakePool(rowsFor(PRODUCTION_SHAPES)))).resolves.toBe('ok');
  });

  it('reports drift when a push_session column is missing', async () => {
    const missing = rowsFor({
      ...PRODUCTION_SHAPES,
      push_session: [
        ['username', 'text'],
        ['timestamp', 'bigint'],
        ['service', 'text'],
        ['xml', 'text'],
      ],
    });

    await expect(checkEjabberdSchema(fakePool(missing))).resolves.toBe('drift');
  });

  it('reports drift when a push_session column is retyped', async () => {
    const retyped = rowsFor({
      ...PRODUCTION_SHAPES,
      push_session: [
        ['username', 'text'],
        ['timestamp', 'bigint'],
        ['service', 'text'],
        ['node', 'jsonb'],
        ['xml', 'text'],
      ],
    });

    await expect(checkEjabberdSchema(fakePool(retyped))).resolves.toBe('drift');
  });

  it('reports unknown when the query fails', async () => {
    await expect(checkEjabberdSchema(failingPool())).resolves.toBe('unknown');
  });
});
