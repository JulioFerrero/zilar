import { PGlite } from '@electric-sql/pglite';
import { afterEach, describe, expect, it } from 'vitest';

// Applies the two T-0108 migrations to a database that already has groups
// but no topics tables (simulating a pre-T-0108 install), then checks the
// General backfill. Reads the SQL files directly so the test pins the real
// migration text, including the custom backfill.
describe('general topics backfill', () => {
  let client: PGlite | null = null;

  afterEach(async () => {
    await client?.close();
    client = null;
  });

  it('creates one General topic per pre-existing group', async () => {
    client = new PGlite();
    const fs = await import('node:fs');
    const path = await import('node:path');
    const url = await import('node:url');
    const dir = path.dirname(url.fileURLToPath(import.meta.url));
    const drizzleDir = path.join(dir, '..', '..', 'drizzle');
    const apply = async (file: string) => {
      const sql = fs.readFileSync(path.join(drizzleDir, file), 'utf8');
      for (const statement of sql.split('--> statement-breakpoint')) {
        const trimmed = statement.trim();
        if (trimmed !== '') {
          await client!.query(trimmed);
        }
      }
    };
    // Pre-T-0108 state: every migration except the topics ones (0018, 0019),
    // the T-0109 topic-AI table (0020, which needs the topics tables) and
    // the T-0110 topic-scope columns/backfill (0021, 0022, covered by the
    // topic-scope backfill test).
    for (const file of fs.readdirSync(drizzleDir).sort()) {
      if (
        !file.endsWith('.sql') ||
        file.startsWith('0018_') ||
        file.startsWith('0019_') ||
        file.startsWith('0020_') ||
        file.startsWith('0021_') ||
        file.startsWith('0022_')
      ) {
        continue;
      }
      await apply(file);
    }
    await client.query(
      `INSERT INTO "user" ("id", "name", "email") VALUES ('u1','U1','u1@example.com'),('u2','U2','u2@example.com')`,
    );
    await client.query(
      `INSERT INTO "groups" ("id", "room_localpart", "title", "created_by") VALUES ('g1','groomaaaaaaaaaaaaa','Old A','u1'),('g2','groombbbbbbbbbbbbb','Old B','u2')`,
    );
    await apply('0018_lethal_warhawk.sql');
    await apply('0019_general-topics.sql');
    const result = await client.query(
      `SELECT group_id, name, room_localpart, visibility, is_general FROM topics ORDER BY group_id`,
    );
    expect(result.rows).toEqual([
      {
        group_id: 'g1',
        name: 'General',
        room_localpart: 'groomaaaaaaaaaaaaa',
        visibility: 'public',
        is_general: true,
      },
      {
        group_id: 'g2',
        name: 'General',
        room_localpart: 'groombbbbbbbbbbbbb',
        visibility: 'public',
        is_general: true,
      },
    ]);
    // Idempotent: running the backfill again changes nothing.
    await apply('0019_general-topics.sql');
    const again = await client.query(`SELECT count(*)::int AS total FROM topics`);
    expect((again.rows[0] as { total: number }).total).toBe(2);
  });
});
