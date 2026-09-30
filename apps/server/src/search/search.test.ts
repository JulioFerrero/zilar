import { PGlite } from '@electric-sql/pglite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { aiLimits, ais, groups, providerConnections } from '../db/schema';
import { headlineToSnippet, correctionTarget, retractTarget } from './routes';
import {
  bootstrapUser,
  contactOf,
  createTestContext,
  testApp,
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

function messageXml(body: string): string {
  return `<message type="chat"><body>${body}</body></message>`;
}

function correctionXml(body: string, originalId: string): string {
  return `<message type="chat"><body>${body}</body><replace xmlns="urn:xmpp:message-correct:0" id="${originalId}"/></message>`;
}

function retractXml(targetId: string): string {
  return `<message type="chat"><body>This person attempted to retract a previous message.</body><retract xmlns="urn:xmpp:message-retract:1" id="${targetId}"/></message>`;
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
    const stranger = await bootstrapUser(context, app, 'stranger@example.com');
    return { alice, bob, stranger };
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
    const [groupRow] = await context.db.select().from(groups).where(eq(groups.id, group.id));
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
    await context.db.insert(providerConnections).values({
      id: connectionId,
      owner: alice.id,
      provider: 'openai',
      encryptedKey: 'not-a-real-key',
      label: null,
    });
    const aiId = randomUUID();
    const aiLocalpart = `ai-${aiId}`;
    const aiJid = `${aiLocalpart}@${TEST_XMPP_DOMAIN}`;
    await context.db.insert(ais).values({
      id: aiId,
      owner: alice.id,
      name: 'Helper',
      template: 'dev',
      persona: 'A persona',
      providerConnectionId: connectionId,
      model: 'gpt-4o-mini',
      localpart: aiLocalpart,
      jid: aiJid,
      status: 'active',
    });
    await context.db.insert(aiLimits).values({ aiId, perDayUsd: '1.00', perMonthUsd: '20.00' });

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
});
