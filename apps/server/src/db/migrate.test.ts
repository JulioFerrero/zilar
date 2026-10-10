import { PGlite } from '@electric-sql/pglite';
import { Effect } from 'effect';
import { SqlClient } from 'effect/sql';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { disposeSqlRuntime, registerSqlRuntime, sqlRuntimeFor } from '../effect/sql';
import { runMigrations } from './migrate';

describe('runMigrations', () => {
  let client: PGlite;

  beforeEach(() => {
    client = new PGlite();
    registerSqlRuntime(client, '');
  });

  afterEach(async () => {
    await disposeSqlRuntime(client);
    await client.close();
  });

  // Runs one SQL text on the effect/sql runtime registered for this database.
  // Column names come back camelCased, as the server reads them.
  function sqlRows<Row extends object>(text: string): Promise<ReadonlyArray<Row>> {
    return sqlRuntimeFor(client).runPromise(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        return yield* sql.unsafe<Row>(text);
      }),
    );
  }

  async function sqlExec(text: string): Promise<void> {
    await sqlRows(text);
  }

  async function seedDelegationScope() {
    await sqlExec(
      `INSERT INTO "user" (id, name, email) VALUES ('u1', 'Owner', 'owner@example.com')`,
    );
    await sqlExec(`INSERT INTO provider_connections (id, owner, provider, encrypted_key)
      VALUES ('pc1', 'u1', 'openai', 'CHANGE_ME')`);
    await sqlExec(`INSERT INTO ais (id, owner, name, template, persona, provider_connection_id,
      model, localpart, jid) VALUES
      ('ai1', 'u1', 'One', 'dev', 'A helpful AI.', 'pc1', 'gpt-test', 'ai-one', 'ai-one@example.com'),
      ('ai2', 'u1', 'Two', 'dev', 'A helpful AI.', 'pc1', 'gpt-test', 'ai-two', 'ai-two@example.com')`);
    await sqlExec(
      `INSERT INTO groups (id, room_localpart, title, created_by) VALUES ('g1', 'room-g1', 'Group', 'u1')`,
    );
  }

  it('creates the server_meta table', async () => {
    await runMigrations(client);

    const result = await client.query<{ table: string | null }>(
      "select to_regclass('public.server_meta') as table",
    );
    expect(result.rows[0]?.table).toBe('server_meta');
  });

  it('round-trips an insert and a select', async () => {
    await runMigrations(client);

    await sqlExec(`INSERT INTO server_meta (key, value) VALUES ('greeting', 'hello')`);
    const rows = await sqlRows(`SELECT * FROM server_meta`);

    expect(rows).toEqual([{ key: 'greeting', value: 'hello', updatedAt: expect.any(Date) }]);
  });

  it('is a no-op when run twice', async () => {
    await runMigrations(client);
    await sqlExec(`INSERT INTO server_meta (key, value) VALUES ('greeting', 'hello')`);

    await runMigrations(client);

    const rows = await sqlRows(`SELECT * FROM server_meta`);
    expect(rows).toHaveLength(1);
  });

  it('creates the auth and invite tables', async () => {
    await runMigrations(client);

    const rows = [
      await sqlRows(`SELECT * FROM "user" LIMIT 0`),
      await sqlRows(`SELECT * FROM "session" LIMIT 0`),
      await sqlRows(`SELECT * FROM "account" LIMIT 0`),
      await sqlRows(`SELECT * FROM "verification" LIMIT 0`),
      await sqlRows(`SELECT * FROM invites LIMIT 0`),
    ];

    expect(rows).toEqual([[], [], [], [], []]);
  });

  it('creates the membership lookup indexes', async () => {
    await runMigrations(client);

    const rows = await sqlRows<{ indexname: string }>(
      `SELECT indexname FROM pg_indexes WHERE schemaname = 'public' AND indexname IN (
        'group_members_user_id_idx', 'topic_members_user_id_idx', 'topic_ais_ai_id_idx',
        'group_ais_ai_id_idx', 'group_member_roles_user_id_idx', 'xmpp_accounts_lower_jid_idx',
        'contacts_contact_user_id_idx')
      ORDER BY indexname`,
    );

    expect(rows.map((row) => row.indexname)).toEqual([
      'contacts_contact_user_id_idx',
      'group_ais_ai_id_idx',
      'group_member_roles_user_id_idx',
      'group_members_user_id_idx',
      'topic_ais_ai_id_idx',
      'topic_members_user_id_idx',
      'xmpp_accounts_lower_jid_idx',
    ]);
  });

  it('defaults a new group to listener off with normal eagerness', async () => {
    await runMigrations(client);
    await seedDelegationScope();

    const rows = await sqlRows(`SELECT listener_enabled, listener_eagerness FROM groups`);

    expect(rows).toEqual([{ listenerEnabled: false, listenerEagerness: 'normal' }]);
  });

  it('rejects an unknown listener eagerness', async () => {
    await runMigrations(client);
    await seedDelegationScope();

    await expect(
      client.query(
        "insert into groups (id, room_localpart, title, created_by, listener_eagerness) values ('g2', 'room-g2', 'Group', 'u1', 'loud')",
      ),
    ).rejects.toThrow(/groups_listener_eagerness_check/);
  });

  it('defaults the AI delegation flags off', async () => {
    await runMigrations(client);
    await seedDelegationScope();

    const rows = await sqlRows(`SELECT can_delegate, accepts_delegation FROM ais`);

    expect(rows).toEqual([
      { canDelegate: false, acceptsDelegation: false },
      { canDelegate: false, acceptsDelegation: false },
    ]);
  });

  it('rejects a delegation from an AI to itself', async () => {
    await runMigrations(client);
    await seedDelegationScope();

    await expect(
      client.query(
        "insert into ai_delegations (id, from_ai_id, to_ai_id, group_id, objective) values ('d1', 'ai1', 'ai1', 'g1', 'Do the thing')",
      ),
    ).rejects.toThrow(/ai_delegations_different_ais_check/);
  });

  it('defaults a new delegation to working with empty arrays', async () => {
    await runMigrations(client);
    await seedDelegationScope();

    await sqlExec(`INSERT INTO ai_delegations (id, from_ai_id, to_ai_id, group_id, objective)
      VALUES ('d1', 'ai1', 'ai2', 'g1', 'Do the thing')`);

    const rows = await sqlRows(`SELECT status, acceptance FROM ai_delegations`);

    expect(rows).toEqual([{ status: 'working', acceptance: [] }]);
  });
});
