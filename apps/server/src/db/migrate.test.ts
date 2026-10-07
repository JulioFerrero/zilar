import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { PgliteServerDatabase } from './client';
import { runMigrations } from './migrate';
import * as schema from './schema';
import {
  account,
  aiDelegations,
  ais,
  groups,
  invites,
  providerConnections,
  serverMeta,
  session,
  user,
  verification,
} from './schema';

describe('runMigrations', () => {
  let client: PGlite;
  let db: PgliteServerDatabase;

  beforeEach(() => {
    client = new PGlite();
    db = drizzle(client, { schema });
  });

  afterEach(async () => {
    await client.close();
  });

  async function seedDelegationScope() {
    await db.insert(user).values({ id: 'u1', name: 'Owner', email: 'owner@example.com' });
    await db.insert(providerConnections).values({
      id: 'pc1',
      owner: 'u1',
      provider: 'openai',
      encryptedKey: 'CHANGE_ME',
    });
    await db.insert(ais).values([
      {
        id: 'ai1',
        owner: 'u1',
        name: 'One',
        template: 'dev',
        persona: 'A helpful AI.',
        providerConnectionId: 'pc1',
        model: 'gpt-test',
        localpart: 'ai-one',
        jid: 'ai-one@example.com',
      },
      {
        id: 'ai2',
        owner: 'u1',
        name: 'Two',
        template: 'dev',
        persona: 'A helpful AI.',
        providerConnectionId: 'pc1',
        model: 'gpt-test',
        localpart: 'ai-two',
        jid: 'ai-two@example.com',
      },
    ]);
    await db
      .insert(groups)
      .values({ id: 'g1', roomLocalpart: 'room-g1', title: 'Group', createdBy: 'u1' });
  }

  it('creates the server_meta table', async () => {
    await runMigrations(db);

    const result = await client.query<{ table: string | null }>(
      "select to_regclass('public.server_meta') as table",
    );
    expect(result.rows[0]?.table).toBe('server_meta');
  });

  it('round-trips an insert and a select', async () => {
    await runMigrations(db);

    await db.insert(serverMeta).values({ key: 'greeting', value: 'hello' });
    const rows = await db.select().from(serverMeta);

    expect(rows).toEqual([{ key: 'greeting', value: 'hello', updatedAt: expect.any(Date) }]);
  });

  it('is a no-op when run twice', async () => {
    await runMigrations(db);
    await db.insert(serverMeta).values({ key: 'greeting', value: 'hello' });

    await runMigrations(db);

    const rows = await db.select().from(serverMeta);
    expect(rows).toHaveLength(1);
  });

  it('creates the auth and invite tables', async () => {
    await runMigrations(db);

    const rows = [
      await db.select().from(user).limit(0),
      await db.select().from(session).limit(0),
      await db.select().from(account).limit(0),
      await db.select().from(verification).limit(0),
      await db.select().from(invites).limit(0),
    ];

    expect(rows).toEqual([[], [], [], [], []]);
  });

  it('defaults a new group to listener off with normal eagerness', async () => {
    await runMigrations(db);
    await seedDelegationScope();

    const rows = await db
      .select({
        listenerEnabled: groups.listenerEnabled,
        listenerEagerness: groups.listenerEagerness,
      })
      .from(groups);

    expect(rows).toEqual([{ listenerEnabled: false, listenerEagerness: 'normal' }]);
  });

  it('rejects an unknown listener eagerness', async () => {
    await runMigrations(db);
    await seedDelegationScope();

    await expect(
      client.query(
        "insert into groups (id, room_localpart, title, created_by, listener_eagerness) values ('g2', 'room-g2', 'Group', 'u1', 'loud')",
      ),
    ).rejects.toThrow(/groups_listener_eagerness_check/);
  });

  it('defaults the AI delegation flags off', async () => {
    await runMigrations(db);
    await seedDelegationScope();

    const rows = await db
      .select({ canDelegate: ais.canDelegate, acceptsDelegation: ais.acceptsDelegation })
      .from(ais);

    expect(rows).toEqual([
      { canDelegate: false, acceptsDelegation: false },
      { canDelegate: false, acceptsDelegation: false },
    ]);
  });

  it('rejects a delegation from an AI to itself', async () => {
    await runMigrations(db);
    await seedDelegationScope();

    await expect(
      client.query(
        "insert into ai_delegations (id, from_ai_id, to_ai_id, group_id, objective) values ('d1', 'ai1', 'ai1', 'g1', 'Do the thing')",
      ),
    ).rejects.toThrow(/ai_delegations_different_ais_check/);
  });

  it('defaults a new delegation to working with empty arrays', async () => {
    await runMigrations(db);
    await seedDelegationScope();

    await db.insert(aiDelegations).values({
      id: 'd1',
      fromAiId: 'ai1',
      toAiId: 'ai2',
      groupId: 'g1',
      objective: 'Do the thing',
    });

    const rows = await db
      .select({ status: aiDelegations.status, acceptance: aiDelegations.acceptance })
      .from(aiDelegations);

    expect(rows).toEqual([{ status: 'working', acceptance: [] }]);
  });
});
