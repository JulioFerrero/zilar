import { PGlite } from '@electric-sql/pglite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Effect } from 'effect';
import { SqlClient } from 'effect/sql';
import { randomUUID } from 'node:crypto';
import { headlineToSnippet, correctionTarget, retractTarget, stanzaFrom } from './routes';
import {
  bootstrapUser,
  contactOf,
  createTestContext,
  testApp,
  testSql,
  TEST_BASE_URL,
  TEST_XMPP_DOMAIN,
  TEST_XMPP_MUC_DOMAIN,
  type TestContext,
} from '../test-support';
import { createApp } from '../app';
import { localpartFor } from '../xmpp/provisioning';
import type { ArchivePool, ArchiveRow } from './service';

// PGlite shapes the fake the way the real `archive` table is shaped (see
// docs/SEARCH_NOTES.md): username/timestamp/peer/bare_peer/xml/txt,
// kind chat/groupchat, nick, origin_id. `txt` carries the body cdata.
const ARCHIVE_DDL = `CREATE TABLE archive (
  username text NOT NULL,
  timestamp bigint NOT NULL,
  peer text NOT NULL,
  bare_peer text NOT NULL,
  xml text NOT NULL,
  txt text,
  id bigserial,
  kind text,
  nick text,
  origin_id text NOT NULL
);`;

function messageXml(body: string, from?: string): string {
  return `<message type="chat"${from === undefined ? '' : ` from="${from}"`}><body>${body}</body></message>`;
}

function correctionXml(body: string, originalId: string): string {
  return `<message type="chat"><body>${body}</body><replace xmlns="urn:xmpp:message-correct:0" id="${originalId}"/></message>`;
}

function retractXml(targetId: string): string {
  return `<message type="chat"><body>This person attempted to retract a previous message.</body><retract xmlns="urn:xmpp:message-retract:1" id="${targetId}"/></message>`;
}

interface GroupRow {
  roomLocalpart: string;
}

interface SeedRow {
  owner: string;
  peer: string;
  barePeer: string;
  kind: 'chat' | 'groupchat';
  nick: string;
  originId: string;
  timestamp: number;
  txt: string;
  xml: string;
}

// A fake ArchivePool backed by a second PGlite. It runs the real
// parameterized query text (`$n` bindings, never interpolated), so
// SQL-metacharacter queries are proven to be data, and `chat` filtering is
// proven against the real full-text functions.
function pgliteArchivePool(client: PGlite): ArchivePool {
  return {
    query: (async (text: string, values: unknown[]) => {
      const bound = values.map((value) => {
        if (typeof value === 'bigint') return value.toString();
        if (Array.isArray(value)) {
          if (value.length === 0) return '{}';
          return `{${value.map((entry) => `"${String(entry).replaceAll('"', '""')}"`).join(',')}}`;
        }
        return value;
      });
      const result = await client.query(text, bound as never[]);
      return result.rows as ArchiveRow[];
    }) as ArchivePool['query'],
    close: async () => {},
  };
}

async function seedArchive(client: PGlite, rows: SeedRow[]): Promise<void> {
  for (const row of rows) {
    await client.query(
      `INSERT INTO archive (username, timestamp, peer, bare_peer, xml, txt, kind, nick, origin_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        row.owner,
        row.timestamp,
        row.peer,
        row.barePeer,
        row.xml,
        row.txt,
        row.kind,
        row.nick,
        row.originId,
      ],
    );
  }
}

interface SearchBody {
  items: Array<{
    chatJid: string;
    messageId: string;
    senderName: string;
    at: string;
    snippet: string;
    marks: Array<[number, number]>;
    match?: 'exact' | 'fuzzy';
  }>;
  nextBefore?: string;
  error?: { code: string };
}

describe('GET /api/search', () => {
  let context: TestContext;
  let app: ReturnType<typeof createApp>;
  let archiveClient: PGlite;
  let archive: ArchivePool;
  let now = 1_700_000_000_000;

  beforeEach(async () => {
    context = await createTestContext();
    archiveClient = new PGlite();
    await archiveClient.exec(ARCHIVE_DDL);
    archive = pgliteArchivePool(archiveClient);
    // The production app mounts search with the archive pool; the plain
    // test app has none (501), so build the app directly with the fake.
    app = createApp({
      db: context.db,
      logger: context.logger,
      config: context.config,
      auth: context.auth,
      adminClient: context.adminClient,
      archive,
      searchNow: () => now,
    });
    now = 1_700_000_000_000;
  });

  afterEach(async () => {
    await context.close();
    await archiveClient.close();
  });

  async function search(
    cookie: string,
    params: string,
  ): Promise<{ status: number; body: SearchBody }> {
    const response = await app.request(`${TEST_BASE_URL}/api/search${params}`, {
      headers: { cookie },
    });
    return { status: response.status, body: (await response.json()) as SearchBody };
  }

  async function createGroup(cookie: string, title: string, memberIds: string[]) {
    const response = await app.request(`${TEST_BASE_URL}/api/groups`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ title, memberIds }),
    });
    expect(response.status).toBe(201);
    return (await response.json()) as { id: string };
  }

  async function createTopic(cookie: string, groupId: string, body: unknown) {
    const response = await app.request(`${TEST_BASE_URL}/api/groups/${groupId}/topics`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify(body),
    });
    expect(response.status).toBe(201);
    return (await response.json()) as { id: string; chatJid: string };
  }

  async function setupDm() {
    const alice = await bootstrapUser(context, app, 'alice@example.com');
    const bob = await contactOf(context, app, alice.id, 'bob@example.com');
    await renameUser(alice.cookie, 'Alice');
    await renameUser(bob.cookie, 'Bob');
    const stranger = await bootstrapUser(context, app, 'stranger@example.com');
    return { alice, bob, stranger };
  }

  async function renameUser(cookie: string, name: string) {
    const response = await app.request(`${TEST_BASE_URL}/api/me`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ name }),
    });
    expect(response.status).toBe(200);
  }

  function dmJid(userId: string): string {
    return `${localpartFor(userId)}@${TEST_XMPP_DOMAIN}`;
  }

  it('matches, orders newest first, and builds snippet marks', async () => {
    const { alice, bob } = await setupDm();
    const own = localpartFor(alice.id);
    const peer = dmJid(bob.id);
    await seedArchive(archiveClient, [
      {
        owner: own,
        peer: `${peer}/r1`,
        barePeer: peer,
        kind: 'chat',
        nick: '',
        originId: 'o-old',
        timestamp: 1_780_000_000_000_000,
        txt: 'concert tickets are in the drawer',
        xml: messageXml('concert tickets are in the drawer'),
      },
      {
        owner: own,
        peer: `${peer}/r1`,
        barePeer: peer,
        kind: 'chat',
        nick: '',
        originId: 'o-new',
        timestamp: 1_785_000_000_000_000,
        txt: 'did you buy concert tickets yet',
        xml: messageXml('did you buy concert tickets yet'),
      },
    ]);

    const { status, body } = await search(alice.cookie, '?q=concert%20tickets');
    expect(status).toBe(200);
    expect(body.items).toHaveLength(2);
    expect(body.items[0]?.messageId).toBe('o-new');
    expect(body.items[1]?.messageId).toBe('o-old');
    expect(body.items[0]?.chatJid).toBe(peer);
    const first = body.items[0];
    expect(first?.snippet).not.toMatch(/<[^>]+>/);
    expect(first?.snippet).toContain('concert');
    for (const [start, end] of first?.marks ?? []) {
      expect([...(first?.snippet ?? '')].slice(start, end).join('')).toMatch(/concert|tickets/i);
    }
  });

  it('attributes DM senders from the stanza: mine say You, theirs name the peer', async () => {
    const { alice, bob } = await setupDm();
    const own = localpartFor(alice.id);
    const ownJid = dmJid(alice.id);
    const peer = dmJid(bob.id);
    await seedArchive(archiveClient, [
      {
        owner: own,
        peer: `${peer}/r1`,
        barePeer: peer,
        kind: 'chat',
        nick: '',
        originId: 'o-mine',
        timestamp: 1_785_000_000_000_000,
        txt: 'papaya outgoing plans',
        xml: messageXml('papaya outgoing plans', `${ownJid}/desk`),
      },
      {
        owner: own,
        peer: `${peer}/r1`,
        barePeer: peer,
        kind: 'chat',
        nick: '',
        originId: 'o-theirs',
        timestamp: 1_784_000_000_000_000,
        txt: 'papaya incoming answer',
        xml: messageXml('papaya incoming answer', `${peer}/phone`),
      },
      {
        owner: own,
        peer: `${peer}/r1`,
        barePeer: peer,
        kind: 'chat',
        nick: '',
        originId: 'o-broken',
        timestamp: 1_783_000_000_000_000,
        txt: 'papaya broken stanza',
        xml: '<message type="chat"><body>papaya broken stanza</body></message',
      },
    ]);

    const { status, body } = await search(alice.cookie, '?q=papaya');
    expect(status).toBe(200);
    expect(body.items.map((item) => item.messageId)).toEqual(['o-mine', 'o-theirs', 'o-broken']);
    expect(body.items.map((item) => item.senderName)).toEqual(['You', 'Bob', 'Bob']);
  });

  it('pages with a before cursor and a limit', async () => {
    const { alice, bob } = await setupDm();
    const own = localpartFor(alice.id);
    const peer = dmJid(bob.id);
    const rows: SeedRow[] = [];
    for (let i = 0; i < 5; i += 1) {
      rows.push({
        owner: own,
        peer: `${peer}/r1`,
        barePeer: peer,
        kind: 'chat',
        nick: '',
        originId: `o-${i}`,
        timestamp: 1_780_000_000_000_000 + i * 1_000_000,
        txt: `pineapple note number ${i}`,
        xml: messageXml(`pineapple note number ${i}`),
      });
    }
    await seedArchive(archiveClient, rows);

    const first = await search(alice.cookie, '?q=pineapple&limit=2');
    expect(first.status).toBe(200);
    expect(first.body.items.map((item) => item.messageId)).toEqual(['o-4', 'o-3']);
    expect(typeof first.body.nextBefore).toBe('string');

    const second = await search(
      alice.cookie,
      `?q=pineapple&limit=2&before=${first.body.nextBefore}`,
    );
    expect(second.body.items.map((item) => item.messageId)).toEqual(['o-2', 'o-1']);
    expect(typeof second.body.nextBefore).toBe('string');

    const third = await search(
      alice.cookie,
      `?q=pineapple&limit=2&before=${second.body.nextBefore}`,
    );
    expect(third.body.items.map((item) => item.messageId)).toEqual(['o-0']);
    expect(third.body.nextBefore).toBeUndefined();
  });

  it('shows the latest correction only and hides retracted messages', async () => {
    const { alice, bob } = await setupDm();
    const own = localpartFor(alice.id);
    const peer = dmJid(bob.id);
    await seedArchive(archiveClient, [
      {
        owner: own,
        peer: `${peer}/r1`,
        barePeer: peer,
        kind: 'chat',
        nick: '',
        originId: 'o-1',
        timestamp: 1_780_000_000_000_000,
        txt: 'avocado toast plan',
        xml: messageXml('avocado toast plan'),
      },
      {
        owner: own,
        peer: `${peer}/r1`,
        barePeer: peer,
        kind: 'chat',
        nick: '',
        originId: 'o-2',
        timestamp: 1_781_000_000_000_000,
        txt: 'avocado brunch corrected plan',
        xml: correctionXml('avocado brunch corrected plan', 'o-1'),
      },
      {
        owner: own,
        peer: `${peer}/r1`,
        barePeer: peer,
        kind: 'chat',
        nick: '',
        originId: 'o-3',
        timestamp: 1_782_000_000_000_000,
        txt: 'strawberry picnic',
        xml: messageXml('strawberry picnic'),
      },
      {
        owner: own,
        peer: `${peer}/r1`,
        barePeer: peer,
        kind: 'chat',
        nick: '',
        originId: 'o-4',
        timestamp: 1_783_000_000_000_000,
        txt: 'This person attempted to retract a previous message.',
        xml: retractXml('o-3'),
      },
    ]);

    const corrected = await search(alice.cookie, '?q=avocado');
    expect(corrected.body.items).toHaveLength(1);
    expect(corrected.body.items[0]?.snippet).toContain('brunch');

    const retracted = await search(alice.cookie, '?q=strawberry');
    expect(retracted.body.items).toHaveLength(0);

    const fallback = await search(alice.cookie, '?q=retract');
    expect(fallback.body.items).toHaveLength(0);
  });

  it('never shows another user DM, a left group, or a private topic the caller is not in', async () => {
    const { alice, bob, stranger } = await setupDm();
    const group = await createGroup(alice.cookie, 'Team', [bob.id]);
    const [groupRow] = await testSql(context)(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        return yield* sql<GroupRow>`SELECT room_localpart FROM groups WHERE id = ${group.id}`;
      }),
    );
    const generalJid = `${groupRow?.roomLocalpart}@${TEST_XMPP_MUC_DOMAIN}`;
    const secret = await createTopic(alice.cookie, group.id, {
      name: 'Hiring',
      visibility: 'private',
      memberIds: [],
    });

    // Bob leaves the group; the stranger never belonged to anything.
    const leave = await app.request(`${TEST_BASE_URL}/api/groups/${group.id}/members/${bob.id}`, {
      method: 'DELETE',
      headers: { cookie: bob.cookie },
    });
    expect(leave.status).toBe(200);

    const strangerLocal = localpartFor(stranger.id);
    await seedArchive(archiveClient, [
      {
        owner: strangerLocal,
        peer: `${dmJid(alice.id)}/r`,
        barePeer: dmJid(alice.id),
        kind: 'chat',
        nick: '',
        originId: 'o-stranger',
        timestamp: 1_785_000_000_000_000,
        txt: 'quokka secrets of strangers',
        xml: messageXml('quokka secrets of strangers'),
      },
      {
        owner: generalJid,
        peer: 'someone@x/r',
        barePeer: 'someone@x',
        kind: 'groupchat',
        nick: 'Alice',
        originId: 'o-team',
        timestamp: 1_785_000_000_000_000,
        txt: 'quokka team roadmap',
        xml: messageXml('quokka team roadmap'),
      },
      {
        owner: secret.chatJid,
        peer: 'someone@x/r',
        barePeer: 'someone@x',
        kind: 'groupchat',
        nick: 'Alice',
        originId: 'o-hiring',
        timestamp: 1_785_000_000_000_000,
        txt: 'quokka hiring shortlist',
        xml: messageXml('quokka hiring shortlist'),
      },
    ]);

    // Alice sees General and her own private topic, but not the DM archived
    // under the stranger's username.
    const aliceFound = await search(alice.cookie, '?q=quokka');
    expect(aliceFound.body.items.map((item) => item.messageId).sort()).toEqual(
      ['o-hiring', 'o-team'].sort(),
    );

    // Bob left the group: no team hits even though the rows still exist.
    const bobFound = await search(bob.cookie, '?q=quokka');
    expect(bobFound.body.items).toHaveLength(0);

    // The stranger sees nothing: no shared group, no DM with Alice.
    const strangerFound = await search(stranger.cookie, '?q=quokka');
    expect(strangerFound.body.items).toHaveLength(0);
  });

  it('answers 404 for a chat filter outside the allowed set', async () => {
    const { alice, bob, stranger } = await setupDm();
    const own = localpartFor(alice.id);
    const peer = dmJid(bob.id);
    await seedArchive(archiveClient, [
      {
        owner: own,
        peer: `${peer}/r1`,
        barePeer: peer,
        kind: 'chat',
        nick: '',
        originId: 'o-1',
        timestamp: 1_785_000_000_000_000,
        txt: 'mango sticky rice',
        xml: messageXml('mango sticky rice'),
      },
    ]);

    const ok = await search(alice.cookie, `?q=mango&chat=${encodeURIComponent(peer)}`);
    expect(ok.status).toBe(200);
    expect(ok.body.items).toHaveLength(1);

    const foreign = await search(stranger.cookie, `?q=mango&chat=${encodeURIComponent(peer)}`);
    expect(foreign.status).toBe(404);
    expect(foreign.body.error?.code).toBe('not_found');

    const missing = await search(alice.cookie, '?q=mango&chat=ghost%40example.com');
    expect(missing.status).toBe(404);
  });

  it('treats SQL metacharacters as text and validates the query', async () => {
    const { alice } = await setupDm();
    const evil = `' OR '1'='1'; DROP TABLE archive; --`;
    const response = await search(alice.cookie, `?q=${encodeURIComponent(evil)}`);
    expect(response.status).toBe(200);
    expect(response.body.items).toHaveLength(0);
    // The table survived: a later search still works.
    const again = await search(alice.cookie, '?q=mango');
    expect(again.status).toBe(200);

    expect((await search(alice.cookie, '?q=a')).status).toBe(400);
    expect((await search(alice.cookie, `?q=${'x'.repeat(101)}`)).status).toBe(400);
    expect((await search(alice.cookie, '?q=mango&limit=51')).status).toBe(400);
    expect((await search(alice.cookie, '?q=%20%20')).status).toBe(400);
  });

  it('answers 401 without a session and rate-limits at 30 per minute', async () => {
    const { alice } = await setupDm();
    const anon = await app.request(`${TEST_BASE_URL}/api/search?q=mango`);
    expect(anon.status).toBe(401);

    for (let i = 0; i < 30; i += 1) {
      const response = await app.request(`${TEST_BASE_URL}/api/search?q=mango`, {
        headers: { cookie: alice.cookie },
      });
      expect(response.status).toBe(200);
    }
    const limited = await app.request(`${TEST_BASE_URL}/api/search?q=mango`, {
      headers: { cookie: alice.cookie },
    });
    expect(limited.status).toBe(429);

    now += 61_000;
    const after = await app.request(`${TEST_BASE_URL}/api/search?q=mango`, {
      headers: { cookie: alice.cookie },
    });
    expect(after.status).toBe(200);
  });

  it('never logs the query text', async () => {
    const { alice, bob } = await setupDm();
    const own = localpartFor(alice.id);
    const peer = dmJid(bob.id);
    await seedArchive(archiveClient, [
      {
        owner: own,
        peer: `${peer}/r1`,
        barePeer: peer,
        kind: 'chat',
        nick: '',
        originId: 'o-1',
        timestamp: 1_785_000_000_000_000,
        txt: 'wombat migration notes',
        xml: messageXml('wombat migration notes'),
      },
    ]);
    const before = context.logOutput().length;
    const { status } = await search(alice.cookie, '?q=wombatsecretphrase');
    expect(status).toBe(200);
    const logged = context.logOutput().slice(before);
    expect(logged).not.toContain('wombatsecretphrase');
    expect(logged).toContain('search');
  });

  it('ignores rows older than 12 months', async () => {
    const { alice, bob } = await setupDm();
    const own = localpartFor(alice.id);
    const peer = dmJid(bob.id);
    now = 1_700_000_000_000;
    const oldMicros = BigInt(now - 400 * 24 * 60 * 60 * 1000) * 1000n;
    await seedArchive(archiveClient, [
      {
        owner: own,
        peer: `${peer}/r1`,
        barePeer: peer,
        kind: 'chat',
        nick: '',
        originId: 'o-old',
        timestamp: Number(oldMicros),
        txt: 'kumquat ancient history',
        xml: messageXml('kumquat ancient history'),
      },
    ]);
    const { body } = await search(alice.cookie, '?q=kumquat');
    expect(body.items).toHaveLength(0);
  });

  it('501s without an archive pool', async () => {
    const plain = testApp(context);
    const response = await plain.request(`${TEST_BASE_URL}/api/search?q=mango`, {
      headers: { cookie: (await bootstrapUser(context, plain, 'solo@example.com')).cookie },
    });
    expect(response.status).toBe(501);
    expect(((await response.json()) as SearchBody).error?.code).toBe('search_unavailable');
  });

  it('searches an AI DM under the caller archive', async () => {
    const alice = await bootstrapUser(context, app, 'alice@example.com');
    const connectionId = randomUUID();
    await testSql(context)(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        yield* sql`INSERT INTO provider_connections (id, owner, provider, encrypted_key, label)
          VALUES (${connectionId}, ${alice.id}, ${'openai'}, ${'not-a-real-key'}, ${null})`;
      }),
    );
    const aiId = randomUUID();
    const aiLocalpart = `ai-${aiId}`;
    const aiJid = `${aiLocalpart}@${TEST_XMPP_DOMAIN}`;
    await testSql(context)(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        yield* sql`INSERT INTO ais (id, owner, name, template, persona, provider_connection_id, model, localpart, jid, status)
          VALUES (${aiId}, ${alice.id}, ${'Helper'}, ${'dev'}, ${'A persona'}, ${connectionId}, ${'gpt-4o-mini'}, ${aiLocalpart}, ${aiJid}, ${'active'})`;
        yield* sql`INSERT INTO ai_limits (ai_id, per_day_usd, per_month_usd) VALUES (${aiId}, ${'1.00'}, ${'20.00'})`;
      }),
    );

    await seedArchive(archiveClient, [
      {
        owner: localpartFor(alice.id),
        peer: `${aiJid}/r`,
        barePeer: aiJid,
        kind: 'chat',
        nick: '',
        originId: 'o-ai',
        timestamp: 1_785_000_000_000_000,
        txt: 'zephyr deployment checklist',
        xml: messageXml('zephyr deployment checklist'),
      },
    ]);
    const { status, body } = await search(alice.cookie, '?q=zephyr');
    expect(status).toBe(200);
    expect(body.items.map((item) => item.chatJid)).toEqual([aiJid]);
  });

  it('shows a private topic room to a role holder, never to a non-holder or a leaver', async () => {
    const owner = await bootstrapUser(context, app, 'owner@example.com');
    const holder = await contactOf(context, app, owner.id, 'holder@example.com');
    const outsider = await contactOf(context, app, owner.id, 'outsider@example.com');
    const group = await createGroup(owner.cookie, 'Team', [holder.id, outsider.id]);
    const secret = await createTopic(owner.cookie, group.id, {
      name: 'Design',
      visibility: 'private',
      memberIds: [],
    });
    const [groupRow] = await testSql(context)(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        return yield* sql<GroupRow>`SELECT room_localpart FROM groups WHERE id = ${group.id}`;
      }),
    );
    const generalJid = `${groupRow?.roomLocalpart}@${TEST_XMPP_MUC_DOMAIN}`;

    // A role attached to the private topic: every holder sees the room.
    const created = await app.request(`${TEST_BASE_URL}/api/groups/${group.id}/roles`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: owner.cookie },
      body: JSON.stringify({ name: 'Designers' }),
    });
    expect(created.status).toBe(201);
    const role = (await created.json()) as { id: string };
    const assigned = await app.request(
      `${TEST_BASE_URL}/api/groups/${group.id}/roles/${role.id}/members`,
      {
        method: 'PUT',
        headers: { 'content-type': 'application/json', cookie: owner.cookie },
        body: JSON.stringify({ userIds: [holder.id] }),
      },
    );
    expect(assigned.status).toBe(200);
    const attached = await app.request(`${TEST_BASE_URL}/api/topics/${secret.id}/roles`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json', cookie: owner.cookie },
      body: JSON.stringify({ roleIds: [role.id], approverRoleId: null }),
    });
    expect(attached.status).toBe(200);

    await seedArchive(archiveClient, [
      {
        owner: secret.chatJid,
        peer: 'someone@x/r',
        barePeer: 'someone@x',
        kind: 'groupchat',
        nick: 'Owner',
        originId: 'o-design',
        timestamp: 1_785_000_000_000_000,
        txt: 'quasar design tokens',
        xml: messageXml('quasar design tokens'),
      },
      // Negative control: a public General-room message the outsider must
      // keep finding throughout, proving the test shows scoping rather
      // than total blindness.
      {
        owner: generalJid,
        peer: 'someone@x/r',
        barePeer: 'someone@x',
        kind: 'groupchat',
        nick: 'Owner',
        originId: 'o-general',
        timestamp: 1_785_000_000_000_000,
        txt: 'quasar team standup',
        xml: messageXml('quasar team standup'),
      },
    ]);

    // The role holder finds the room's messages (plus the public room's);
    // the non-holder never sees the secret one.
    const holderFound = await search(holder.cookie, '?q=quasar');
    expect(holderFound.status).toBe(200);
    expect(holderFound.body.items.map((item) => item.messageId).sort()).toEqual(
      ['o-design', 'o-general'].sort(),
    );
    const holderFiltered = await search(
      holder.cookie,
      `?q=quasar&chat=${encodeURIComponent(secret.chatJid)}`,
    );
    expect(holderFiltered.status).toBe(200);
    expect(holderFiltered.body.items).toHaveLength(1);

    const outsiderFound = await search(outsider.cookie, '?q=quasar');
    // The secret room stays hidden, but the public room stays visible.
    expect(outsiderFound.body.items.map((item) => item.messageId)).toEqual(['o-general']);
    const outsiderFiltered = await search(
      outsider.cookie,
      `?q=quasar&chat=${encodeURIComponent(secret.chatJid)}`,
    );
    expect(outsiderFiltered.status).toBe(404);

    // The holder leaves the group: the room drops out of their allowed set.
    const leave = await app.request(
      `${TEST_BASE_URL}/api/groups/${group.id}/members/${holder.id}`,
      { method: 'DELETE', headers: { cookie: holder.cookie } },
    );
    expect(leave.status).toBe(200);
    const leaverFound = await search(holder.cookie, '?q=quasar');
    expect(leaverFound.body.items).toHaveLength(0);
    const leaverFiltered = await search(
      holder.cookie,
      `?q=quasar&chat=${encodeURIComponent(secret.chatJid)}`,
    );
    expect(leaverFiltered.status).toBe(404);

    // The outsider never left: the public control is still visible to them.
    const outsiderAfter = await search(outsider.cookie, '?q=quasar');
    expect(outsiderAfter.body.items.map((item) => item.messageId)).toEqual(['o-general']);
  });

  it('rejects a private topic for a group admin who was not added', async () => {
    const owner = await bootstrapUser(context, app, 'owner@example.com');
    const admin = await contactOf(context, app, owner.id, 'admin@example.com');
    const group = await createGroup(owner.cookie, 'Team', [admin.id]);
    // Promote to admin through the group route would need T-0116; the DB row
    // is enough for the visibility check (member, but not a topic member).
    const secret = await createTopic(owner.cookie, group.id, {
      name: 'Comp',
      visibility: 'private',
      memberIds: [],
    });
    await seedArchive(archiveClient, [
      {
        owner: secret.chatJid,
        peer: 'someone@x/r',
        barePeer: 'someone@x',
        kind: 'groupchat',
        nick: 'Owner',
        originId: 'o-comp',
        timestamp: 1_785_000_000_000_000,
        txt: 'xylophone compensation bands',
        xml: messageXml('xylophone compensation bands'),
      },
    ]);
    const found = await search(admin.cookie, '?q=xylophone');
    expect(found.body.items).toHaveLength(0);
    const filtered = await search(
      admin.cookie,
      `?q=xylophone&chat=${encodeURIComponent(secret.chatJid)}`,
    );
    expect(filtered.status).toBe(404);
  });

  it('uses the room nick for group hits', async () => {
    const { alice, bob } = await setupDm();
    const group = await createGroup(alice.cookie, 'Team', [bob.id]);
    const [groupRow] = await testSql(context)(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        return yield* sql<GroupRow>`SELECT room_localpart FROM groups WHERE id = ${group.id}`;
      }),
    );
    const generalJid = `${groupRow?.roomLocalpart}@${TEST_XMPP_MUC_DOMAIN}`;
    await seedArchive(archiveClient, [
      {
        owner: generalJid,
        peer: `${dmJid(bob.id)}/r`,
        barePeer: dmJid(bob.id),
        kind: 'groupchat',
        nick: 'Bobby',
        originId: 'o-room',
        timestamp: 1_785_000_000_000_000,
        txt: 'durian team lunch',
        xml: `<message type="groupchat" from="${generalJid}/Bobby"><body>durian team lunch</body></message>`,
      },
    ]);
    const { status, body } = await search(alice.cookie, '?q=durian');
    expect(status).toBe(200);
    expect(body.items).toHaveLength(1);
    expect(body.items[0]?.senderName).toBe('Bobby');
    expect(body.items[0]?.chatJid).toBe(generalJid);
  });

  it('finds typos, prefixes, accents and case variants', async () => {
    const { alice, bob } = await setupDm();
    const own = localpartFor(alice.id);
    const peer = dmJid(bob.id);
    await seedArchive(archiveClient, [
      {
        owner: own,
        peer: `${peer}/r1`,
        barePeer: peer,
        kind: 'chat',
        nick: '',
        originId: 'o-extra-e',
        timestamp: 1_785_000_000_000_000,
        txt: 'we said heello to everyone',
        xml: messageXml('we said heello to everyone'),
      },
      {
        owner: own,
        peer: `${peer}/r1`,
        barePeer: peer,
        kind: 'chat',
        nick: '',
        originId: 'o-missing-l',
        timestamp: 1_784_000_000_000_000,
        txt: 'a quick helo there',
        xml: messageXml('a quick helo there'),
      },
      {
        owner: own,
        peer: `${peer}/r1`,
        barePeer: peer,
        kind: 'chat',
        nick: '',
        originId: 'o-transposed',
        timestamp: 1_783_000_000_000_000,
        txt: 'say hlelo kindly',
        xml: messageXml('say hlelo kindly'),
      },
      {
        owner: own,
        peer: `${peer}/r1`,
        barePeer: peer,
        kind: 'chat',
        nick: '',
        originId: 'o-prefix',
        timestamp: 1_786_000_000_000_000,
        txt: 'say hello to the room',
        xml: messageXml('say hello to the room'),
      },
    ]);

    // "hel" finds "hello" (prefix); "hello" finds the typos via the second
    // pass while the exact hit ranks first.
    const prefix = await search(alice.cookie, '?q=hel');
    expect(prefix.status).toBe(200);
    expect(prefix.body.items.map((item) => item.messageId)).toContain('o-prefix');
    expect(prefix.body.items[0]?.match).toBe('exact');

    const fuzzy = await search(alice.cookie, '?q=hello');
    expect(fuzzy.status).toBe(200);
    expect(fuzzy.body.items[0]?.messageId).toBe('o-prefix');
    expect(fuzzy.body.items[0]?.match).toBe('exact');
    expect(fuzzy.body.items.slice(1).map((item) => item.messageId)).toEqual([
      'o-extra-e',
      'o-missing-l',
      'o-transposed',
    ]);
    for (const item of fuzzy.body.items.slice(1)) {
      expect(item.match).toBe('fuzzy');
    }
  });

  it('finds folded accents and upper case with in-code marks', async () => {
    const { alice, bob } = await setupDm();
    const own = localpartFor(alice.id);
    const peer = dmJid(bob.id);
    await seedArchive(archiveClient, [
      {
        owner: own,
        peer: `${peer}/r1`,
        barePeer: peer,
        kind: 'chat',
        nick: '',
        originId: 'o-accent',
        timestamp: 1_785_000_000_000_000,
        txt: 'visit the café today',
        xml: messageXml('visit the café today'),
      },
      {
        owner: own,
        peer: `${peer}/r1`,
        barePeer: peer,
        kind: 'chat',
        nick: '',
        originId: 'o-upper',
        timestamp: 1_784_000_000_000_000,
        txt: 'say HELLO loudly',
        xml: messageXml('say HELLO loudly'),
      },
    ]);

    const accent = await search(alice.cookie, '?q=cafe');
    expect(accent.status).toBe(200);
    expect(accent.body.items.map((item) => item.messageId)).toEqual(['o-accent']);
    const accentItem = accent.body.items[0];
    expect(accentItem?.snippet).toContain('café');
    expect(accentItem?.marks).toHaveLength(1);
    expect(
      [...(accentItem?.snippet ?? '')].slice(...(accentItem?.marks[0] ?? [0, 0])).join(''),
    ).toBe('café');

    const upper = await search(alice.cookie, '?q=HELLO');
    expect(upper.status).toBe(200);
    expect(upper.body.items.map((item) => item.messageId)).toEqual(['o-upper']);
  });

  it('does not match yellow for hello, nor short or far terms', async () => {
    const { alice, bob } = await setupDm();
    const own = localpartFor(alice.id);
    const peer = dmJid(bob.id);
    await seedArchive(archiveClient, [
      {
        owner: own,
        peer: `${peer}/r1`,
        barePeer: peer,
        kind: 'chat',
        nick: '',
        originId: 'o-yellow',
        timestamp: 1_785_000_000_000_000,
        txt: 'the yellow submarine sails',
        xml: messageXml('the yellow submarine sails'),
      },
      {
        owner: own,
        peer: `${peer}/r1`,
        barePeer: peer,
        kind: 'chat',
        nick: '',
        originId: 'o-cat',
        timestamp: 1_784_000_000_000_000,
        txt: 'the car cart broke',
        xml: messageXml('the car cart broke'),
      },
      {
        owner: own,
        peer: `${peer}/r1`,
        barePeer: peer,
        kind: 'chat',
        nick: '',
        originId: 'o-far',
        timestamp: 1_783_000_000_000_000,
        txt: 'entirely hxxlo-adjacent words here',
        xml: messageXml('entirely hxxlo-adjacent words here'),
      },
    ]);

    // "hello" is distance 2 from "yellow" (5-char term allows 1): no hit.
    const yellow = await search(alice.cookie, '?q=hello');
    expect(yellow.status).toBe(200);
    expect(yellow.body.items).toHaveLength(0);

    // A 2-character term never goes fuzzy: "zx" matches nothing even
    // though "car" is nearby, while the prefix rule still applies to real
    // prefixes ("ca" finds "car" through the first pass).
    const short = await search(alice.cookie, '?q=zx');
    expect(short.status).toBe(200);
    expect(short.body.items).toHaveLength(0);
    const prefixShort = await search(alice.cookie, '?q=ca');
    expect(prefixShort.body.items.map((item) => item.messageId)).toEqual(['o-cat']);

    // A 5-character term does not match at distance 2: "hello" vs "hxxlo".
    const far = await search(alice.cookie, '?q=hello');
    expect(far.body.items.map((item) => item.messageId)).not.toContain('o-far');
  });

  it('keeps fuzzy marks on the word with emoji-safe offsets', async () => {
    const { alice, bob } = await setupDm();
    const own = localpartFor(alice.id);
    const peer = dmJid(bob.id);
    await seedArchive(archiveClient, [
      {
        owner: own,
        peer: `${peer}/r1`,
        barePeer: peer,
        kind: 'chat',
        nick: '',
        originId: 'o-emoji',
        timestamp: 1_785_000_000_000_000,
        txt: '🎉 party with heello 🎉 friends',
        xml: messageXml('🎉 party with heello 🎉 friends'),
      },
    ]);
    const { status, body } = await search(alice.cookie, '?q=hello');
    expect(status).toBe(200);
    expect(body.items).toHaveLength(1);
    const item = body.items[0];
    expect(item?.match).toBe('fuzzy');
    expect(item?.marks).toHaveLength(1);
    const [start, end] = item?.marks[0] ?? [0, 0];
    expect(start).toBeGreaterThanOrEqual(0);
    expect(end).toBeLessThanOrEqual([...(item?.snippet ?? '')].length);
    expect([...(item?.snippet ?? '')].slice(start, end).join('')).toBe('heello');
  });

  it('pages across both passes without duplicates', async () => {
    const { alice, bob } = await setupDm();
    const own = localpartFor(alice.id);
    const peer = dmJid(bob.id);
    const rows: SeedRow[] = [
      {
        owner: own,
        peer: `${peer}/r1`,
        barePeer: peer,
        kind: 'chat',
        nick: '',
        originId: 'o-exact',
        timestamp: 1_786_000_000_000_000,
        txt: 'the concert starts soon',
        xml: messageXml('the concert starts soon'),
      },
    ];
    for (let i = 0; i < 3; i += 1) {
      rows.push({
        owner: own,
        peer: `${peer}/r1`,
        barePeer: peer,
        kind: 'chat',
        nick: '',
        originId: `o-fuzzy-${i}`,
        timestamp: 1_785_000_000_000_000 - i * 1_000_000,
        txt: `a concerrt note number ${i}`,
        xml: messageXml(`a concerrt note number ${i}`),
      });
    }
    await seedArchive(archiveClient, rows);

    const first = await search(alice.cookie, '?q=concert&limit=2');
    expect(first.status).toBe(200);
    expect(first.body.items.map((item) => item.messageId)).toEqual(['o-exact', 'o-fuzzy-0']);
    expect(first.body.items.map((item) => item.match)).toEqual(['exact', 'fuzzy']);
    expect(typeof first.body.nextBefore).toBe('string');

    const second = await search(alice.cookie, `?q=concert&limit=2&before=${first.body.nextBefore}`);
    expect(second.body.items.map((item) => item.messageId)).toEqual(['o-fuzzy-1', 'o-fuzzy-2']);
    expect(second.body.items.every((item) => item.match === 'fuzzy')).toBe(true);

    // The second page is exactly full, so the cursor continues; the third
    // page is empty and ends paging.
    const third = await search(alice.cookie, `?q=concert&limit=2&before=${second.body.nextBefore}`);
    expect(third.body.items).toHaveLength(0);
    expect(third.body.nextBefore).toBeUndefined();

    const all = [...first.body.items, ...second.body.items].map((item) => item.messageId);
    expect(new Set(all).size).toBe(all.length);
  });

  it('never leaks fuzzy candidates from rooms the caller may not see', async () => {
    const { alice, bob, stranger } = await setupDm();
    const group = await createGroup(alice.cookie, 'Team', [bob.id]);
    const secret = await createTopic(alice.cookie, group.id, {
      name: 'Hiring',
      visibility: 'private',
      memberIds: [],
    });
    const strangerLocal = localpartFor(stranger.id);
    await seedArchive(archiveClient, [
      {
        owner: secret.chatJid,
        peer: 'someone@x/r',
        barePeer: 'someone@x',
        kind: 'groupchat',
        nick: 'Alice',
        originId: 'o-secret-fuzzy',
        timestamp: 1_785_000_000_000_000,
        txt: 'quokka hiring shortlist',
        xml: messageXml('quokka hiring shortlist'),
      },
      {
        owner: strangerLocal,
        peer: `${dmJid(alice.id)}/r`,
        barePeer: dmJid(alice.id),
        kind: 'chat',
        nick: '',
        originId: 'o-dm-fuzzy',
        timestamp: 1_785_000_000_000_000,
        txt: 'quokka stranger notes',
        xml: messageXml('quokka stranger notes'),
      },
    ]);

    // Typo queries must obey the same scoping as exact ones.
    const bobFound = await search(bob.cookie, '?q=quokak');
    expect(bobFound.status).toBe(200);
    expect(bobFound.body.items).toHaveLength(0);

    const strangerFound = await search(stranger.cookie, '?q=quokak');
    expect(strangerFound.body.items).toHaveLength(0);

    const aliceFound = await search(
      alice.cookie,
      `?q=quokak&chat=${encodeURIComponent(secret.chatJid)}`,
    );
    expect(aliceFound.status).toBe(200);
    expect(aliceFound.body.items.map((item) => item.messageId)).toEqual(['o-secret-fuzzy']);
    expect(aliceFound.body.items[0]?.match).toBe('fuzzy');

    const bobFiltered = await search(
      bob.cookie,
      `?q=quokak&chat=${encodeURIComponent(secret.chatJid)}`,
    );
    expect(bobFiltered.status).toBe(404);
  });

  it('applies edit and retraction handling to fuzzy hits', async () => {
    const { alice, bob } = await setupDm();
    const own = localpartFor(alice.id);
    const peer = dmJid(bob.id);
    await seedArchive(archiveClient, [
      {
        owner: own,
        peer: `${peer}/r1`,
        barePeer: peer,
        kind: 'chat',
        nick: '',
        originId: 'o-old',
        timestamp: 1_780_000_000_000_000,
        txt: 'avocado toast plan',
        xml: messageXml('avocado toast plan'),
      },
      {
        owner: own,
        peer: `${peer}/r1`,
        barePeer: peer,
        kind: 'chat',
        nick: '',
        originId: 'o-new',
        timestamp: 1_781_000_000_000_000,
        txt: 'avocado brunch corrected plan',
        xml: correctionXml('avocado brunch corrected plan', 'o-old'),
      },
      {
        owner: own,
        peer: `${peer}/r1`,
        barePeer: peer,
        kind: 'chat',
        nick: '',
        originId: 'o-gone',
        timestamp: 1_782_000_000_000_000,
        txt: 'strawberry picnic',
        xml: messageXml('strawberry picnic'),
      },
      {
        owner: own,
        peer: `${peer}/r1`,
        barePeer: peer,
        kind: 'chat',
        nick: '',
        originId: 'o-retract',
        timestamp: 1_783_000_000_000_000,
        txt: 'This person attempted to retract a previous message.',
        xml: retractXml('o-gone'),
      },
    ]);

    // The typo "avocdao" matches both the old and the corrected row; only
    // the latest text shows, once.
    const corrected = await search(alice.cookie, '?q=avocdao');
    expect(corrected.status).toBe(200);
    expect(corrected.body.items).toHaveLength(1);
    expect(corrected.body.items[0]?.snippet).toContain('brunch');

    const retracted = await search(alice.cookie, '?q=strawbery');
    expect(retracted.status).toBe(200);
    expect(retracted.body.items).toHaveLength(0);
  });

  it('treats operator-only and hostile queries as text', async () => {
    const { alice, bob } = await setupDm();
    const own = localpartFor(alice.id);
    const peer = dmJid(bob.id);
    await seedArchive(archiveClient, [
      {
        owner: own,
        peer: `${peer}/r1`,
        barePeer: peer,
        kind: 'chat',
        nick: '',
        originId: 'o-1',
        timestamp: 1_785_000_000_000_000,
        txt: 'mango sticky rice',
        xml: messageXml('mango sticky rice'),
      },
    ]);

    for (const raw of ['!!!', '   ...   ', 'OR AND NOT', '& | ! ( )', 'and or']) {
      const response = await search(alice.cookie, `?q=${encodeURIComponent(raw)}`);
      expect(response.status).toBe(200);
      expect(response.body.items).toHaveLength(0);
    }

    const long = await search(alice.cookie, `?q=${'x'.repeat(100)}`);
    expect(long.status).toBe(200);
    expect(long.body.items).toHaveLength(0);

    const unicode = await search(
      alice.cookie,
      `?q=${encodeURIComponent('日本語テスト ✓ café 🎉')}`,
    );
    expect(unicode.status).toBe(200);

    // The table survived all of it.
    const again = await search(alice.cookie, '?q=mango');
    expect(again.status).toBe(200);
    expect(again.body.items).toHaveLength(1);
  });
});

describe('headlineToSnippet', () => {
  it('converts sentinel marks to ranges without HTML', () => {
    const { snippet, marks } = headlineToSnippet('hello concert world');
    expect(snippet).toBe('hello concert world');
    expect(marks).toEqual([[6, 13]]);
  });

  it('survives hostile text and unbalanced sentinels', () => {
    const { snippet, marks } = headlineToSnippet('<img src=x onerror=alert(1)>hi');
    expect(snippet).toBe('<img src=x onerror=alert(1)>hi');
    expect(marks).toEqual([]);
  });
});

describe('stanza targets', () => {
  it('reads correction and retraction targets only from namespaced tags', () => {
    expect(correctionTarget('<replace id="o-1"/>')).toBeNull();
    expect(correctionTarget('<replace xmlns="urn:xmpp:message-correct:0" id="o-1"/>')).toBe('o-1');
    expect(retractTarget('<retract id="o-1"/>')).toBeNull();
    expect(
      retractTarget('<message><retract xmlns="urn:xmpp:message-retract:1" id="o-9"/></message>'),
    ).toBe('o-9');
  });

  it('reads the stanza from defensively', () => {
    expect(stanzaFrom('<message type="chat" from="alice@x/desk"><body>hi</body></message>')).toBe(
      'alice@x/desk',
    );
    expect(stanzaFrom("<message from='bob@x/r'><body>hi</body></message>")).toBe('bob@x/r');
    expect(stanzaFrom('<message type="chat"><body>hi</body></message>')).toBeNull();
    expect(stanzaFrom('<message from=""><body>hi</body></message>')).toBeNull();
    expect(stanzaFrom('not xml at all')).toBeNull();
    expect(stanzaFrom('<message type="chat"><body>hi</body></message')).toBeNull();
  });
});
