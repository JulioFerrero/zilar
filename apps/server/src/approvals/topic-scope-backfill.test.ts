import { PGlite } from '@electric-sql/pglite';
import { afterEach, describe, expect, it } from 'vitest';

// Applies the migrations to a database with pre-T-0110 action-pipeline rows
// (approvals, approval_rules and ai_tools naming a group but no topic),
// then checks the T-0110 backfill scoped them to their group's General
// topic and the CHECK constraints reject half-scoped rows. Reads the SQL
// files directly so the test pins the real migration text, including the
// custom backfill.
describe('topic scope backfill', () => {
  let client: PGlite | null = null;

  afterEach(async () => {
    await client?.close();
    client = null;
  });

  it('scopes pre-existing group rows to General and enforces the CHECK', async () => {
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
    // Pre-T-0110 state: everything up to 0020 (topics, General backfill,
    // topic AIs), but not the topic-scope columns (0021) or backfill (0022).
    for (const file of fs.readdirSync(drizzleDir).sort()) {
      if (!file.endsWith('.sql') || file.startsWith('0021_') || file.startsWith('0022_')) {
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
    // The General topics the 0019 backfill would have made for old groups.
    await client.query(
      `INSERT INTO "topics" ("id", "group_id", "name", "glyph", "room_localpart", "visibility", "kind", "status", "is_general", "created_by") VALUES ('t1','g1','General','G','groomaaaaaaaaaaaaa','public','chat','open',TRUE,'u1'),('t2','g2','General','G','groombbbbbbbbbbbbb','public','chat','open',TRUE,'u2')`,
    );
    await client.query(
      `INSERT INTO "provider_connections" ("id", "owner", "provider", "encrypted_key") VALUES ('c1','u1','openai','sealed')`,
    );
    await client.query(
      `INSERT INTO "ais" ("id", "owner", "name", "template", "persona", "provider_connection_id", "model", "localpart", "jid", "status") VALUES ('a1','u1','Helper','dev','A persona','c1','gpt-4o-mini','ai-a1','ai-a1@galena.localhost','active')`,
    );
    // Old-shape rows: a group approval, a personal approval, a group rule,
    // a personal rule and a group tool — all without topic_id.
    await client.query(
      `INSERT INTO "approvals" ("id", "ai_id", "group_id", "action", "summary", "args_hash", "requested_by", "expires_at") VALUES ('ap-group','a1','g1','demo.echo','Group approval','${'a'.repeat(64)}','ai-a1@galena.localhost', now() + interval '1 hour'),('ap-personal','a1',NULL,'demo.echo','Personal approval','${'b'.repeat(64)}','ai-a1@galena.localhost', now() + interval '1 hour')`,
    );
    await client.query(
      `INSERT INTO "approval_rules" ("id", "ai_id", "group_id", "action", "created_by") VALUES ('r-group','a1','g1','demo.echo','u1'),('r-personal','a1',NULL,'demo.echo','u1')`,
    );
    await client.query(
      `INSERT INTO "ai_tools" ("id", "ai_id", "group_id", "name", "description", "created_by") VALUES ('tool-group','a1','g1','prices','Prices tool','u1')`,
    );

    await apply('0021_eager_dark_beast.sql');
    await apply('0022_topic-scope-backfill.sql');

    // Group rows landed on their group's General topic; personal rows kept
    // topic_id NULL.
    const approvals = await client.query(
      `SELECT id, group_id, topic_id FROM approvals ORDER BY id`,
    );
    expect(approvals.rows).toEqual([
      { id: 'ap-group', group_id: 'g1', topic_id: 't1' },
      { id: 'ap-personal', group_id: null, topic_id: null },
    ]);
    const rules = await client.query(
      `SELECT id, group_id, topic_id FROM approval_rules ORDER BY id`,
    );
    expect(rules.rows).toEqual([
      { id: 'r-group', group_id: 'g1', topic_id: 't1' },
      { id: 'r-personal', group_id: null, topic_id: null },
    ]);
    const tools = await client.query(`SELECT id, group_id, topic_id FROM ai_tools`);
    expect(tools.rows).toEqual([{ id: 'tool-group', group_id: 'g1', topic_id: 't1' }]);

    // The CHECK constraints reject a row with only one of the two ids.
    await expect(
      client.query(
        `INSERT INTO "approvals" ("id", "ai_id", "group_id", "topic_id", "action", "summary", "args_hash", "requested_by", "expires_at") VALUES ('ap-half','a1','g1',NULL,'demo.echo','Half','${'c'.repeat(64)}','ai-a1@galena.localhost', now() + interval '1 hour')`,
      ),
    ).rejects.toThrow();
    await expect(
      client.query(
        `INSERT INTO "approval_rules" ("id", "ai_id", "group_id", "topic_id", "action", "created_by") VALUES ('r-half','a1',NULL,'t1','demo.echo','u1')`,
      ),
    ).rejects.toThrow();
    await expect(
      client.query(
        `INSERT INTO "ai_tools" ("id", "ai_id", "group_id", "topic_id", "name", "description", "created_by") VALUES ('tool-half','a1','g1',NULL,'half','Half tool','u1')`,
      ),
    ).rejects.toThrow();

    // Idempotent: running the backfill again changes nothing.
    await apply('0022_topic-scope-backfill.sql');
    const again = await client.query(`SELECT count(*)::int AS total FROM approvals`);
    expect((again.rows[0] as { total: number }).total).toBe(2);
  });
});
