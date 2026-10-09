import { randomUUID } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Effect } from 'effect';
import { SqlClient } from 'effect/sql';
import { createApp } from '../app';
import { localpartFor } from '../xmpp/provisioning';
import {
  bootstrapUser,
  contactOf,
  createTestContext,
  testSql,
  TEST_BASE_URL,
  TEST_XMPP_DOMAIN,
  type TestContext,
} from '../test-support';
import type { ArchivePool, ArchiveRow } from '../search/service';
import { createFilesApi } from './api';

// PGlite shapes the fake the way the real `archive` table is shaped, copied
// from media/routes.test.ts.
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

function escapeXmlText(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

function payloadMessage(payload: unknown, body?: string, from?: string): string {
  const fromAttr = from === undefined ? '' : ` from="${from}"`;
  const bodyXml = body === undefined ? '' : `<body>${escapeXmlText(body)}</body>`;
  return `<message type="chat"${fromAttr}><agent xmlns="urn:zilar:agent:0">${escapeXmlText(JSON.stringify(payload))}</agent>${bodyXml}<store xmlns="urn:xmpp:hints"/></message>`;
}

// Same-origin upload URLs: PUBLIC_URL is http://localhost:3000 in tests and
// the xmpp api base is http://127.0.0.1:5280/api, so the internal fetch goes
// to http://127.0.0.1:5280 with the same path.
const UPLOAD_URL = 'http://localhost:3000/upload/slot1/doc.pdf';
const INTERNAL_URL = 'http://127.0.0.1:5280/upload/slot1/doc.pdf';

const DOC = {
  v: 0,
  type: 'attachment',
  data: {
    kind: 'file',
    url: UPLOAD_URL,
    name: 'doc.pdf',
    size: 11,
    mime: 'application/pdf',
  },
};

function at(iso: string): number {
  return Date.parse(iso) * 1000;
}

interface FetchCall {
  url: string;
  range: string | null;
}

function makeFetch(status: number, headers: Record<string, string>, body: string) {
  const calls: FetchCall[] = [];
  const fetchImpl = (async (input: unknown, init?: { headers?: Record<string, string> }) => {
    const headerMap = new Headers(init?.headers);
    calls.push({ url: String(input), range: headerMap.get('range') });
    return new Response(body, { status, headers });
  }) as typeof fetch;
  return { fetchImpl, calls };
}

describe('GET /api/files', () => {
  let context: TestContext;
  let app: ReturnType<typeof createApp>;
  let archiveClient: PGlite;
  let archive: ArchivePool;
  let now = Date.parse('2026-06-01T00:00:00.000Z');

  beforeEach(async () => {
    context = await createTestContext();
    archiveClient = new PGlite();
    await archiveClient.exec(ARCHIVE_DDL);
    archive = pgliteArchivePool(archiveClient);
    app = createApp({
      db: context.db,
      logger: context.logger,
      config: context.config,
      auth: context.auth,
      adminClient: context.adminClient,
      archive,
      searchNow: () => now,
    });
    now = Date.parse('2026-06-01T00:00:00.000Z');
  });

  afterEach(async () => {
    await context.close();
    await archiveClient.close();
  });

  // The Effect handler matches the full `/api`-prefixed path, so build the
  // request against it directly instead of mounting the old Hono wrapper.
  function filesApp(
    fetchImpl: typeof fetch,
    withoutArchive = false,
  ): { request(url: string, init?: RequestInit): Promise<Response> } {
    const api = createFilesApi({
      auth: context.auth,
      db: context.db,
      config: context.config,
      logger: context.logger,
      ...(withoutArchive ? {} : { archive }),
      now: () => now,
      fetchImpl,
    });
    return {
      request(url: string, init?: RequestInit): Promise<Response> {
        return api.handler(new Request(url, init));
      },
    };
  }

  async function getFile(
    target: { request(url: string, init?: RequestInit): Promise<Response> },
    cookie: string | undefined,
    params: string,
    extraHeaders: Record<string, string> = {},
  ): Promise<{ status: number; headers: Headers; text: string; json: unknown }> {
    const response = await target.request(`${TEST_BASE_URL}/api/files${params}`, {
      headers: { ...(cookie === undefined ? {} : { cookie }), ...extraHeaders },
    });
    const text = await response.text();
    let json: unknown = null;
    try {
      json = JSON.parse(text) as unknown;
    } catch {
      json = null;
    }
    return { status: response.status, headers: response.headers, text, json };
  }

  function dmJid(userId: string): string {
    return `${localpartFor(userId)}@${TEST_XMPP_DOMAIN}`;
  }

  function fileParams(chat: string, url: string = UPLOAD_URL): string {
    return `?chat=${encodeURIComponent(chat)}&url=${encodeURIComponent(url)}`;
  }

  function errorCode(json: unknown): string | undefined {
    if (typeof json === 'object' && json !== null && 'error' in json) {
      const error = (json as { error: unknown }).error;
      if (typeof error === 'object' && error !== null && 'code' in error) {
        return (error as { code: unknown }).code as string;
      }
    }
    return undefined;
  }

  async function setupDm() {
    const alice = await bootstrapUser(context, app, 'alice@example.com');
    const bob = await contactOf(context, app, alice.id, 'bob@example.com');
    const stranger = await bootstrapUser(context, app, 'stranger@example.com');
    return { alice, bob, stranger };
  }

  async function seedMediaItem(own: string, peer: string, messageId: string, name: string) {
    await testSql(context)(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        yield* sql`INSERT INTO media_items ${sql.insert({
          id: randomUUID(),
          archive_owner: own,
          chat_jid: peer,
          message_id: messageId,
          at_micros: at('2026-05-01T00:00:00.000Z'),
          sender_jid: `${peer}/phone`,
          kind: 'file',
          url: UPLOAD_URL,
          name,
          mime: 'application/pdf',
          size: 11,
          ref: UPLOAD_URL,
          deleted: false,
        })}`;
      }),
    );
  }

  it('answers 401 without a session', async () => {
    const { fetchImpl } = makeFetch(200, { 'content-type': 'application/pdf' }, 'x');
    const { status } = await getFile(
      filesApp(fetchImpl),
      undefined,
      fileParams('anyone@zilar.localhost'),
    );
    expect(status).toBe(401);
  });

  it('answers 501 without an archive', async () => {
    const { alice, bob } = await setupDm();
    const { fetchImpl } = makeFetch(200, { 'content-type': 'application/pdf' }, 'x');
    const { status, json } = await getFile(
      filesApp(fetchImpl, true),
      alice.cookie,
      fileParams(dmJid(bob.id)),
    );
    expect(status).toBe(501);
    expect(errorCode(json)).toBe('files_unavailable');
  });

  it('answers 404 for a URL from another origin', async () => {
    const { alice, bob } = await setupDm();
    const { fetchImpl, calls } = makeFetch(200, { 'content-type': 'application/pdf' }, 'x');
    const { status, json } = await getFile(
      filesApp(fetchImpl),
      alice.cookie,
      fileParams(dmJid(bob.id), 'https://evil.example/upload/slot1/doc.pdf'),
    );
    expect(status).toBe(404);
    expect(errorCode(json)).toBe('not_found');
    expect(calls).toEqual([]);
  });

  it('answers 404 for a chat the caller cannot see', async () => {
    const { alice, stranger } = await setupDm();
    const { fetchImpl } = makeFetch(200, { 'content-type': 'application/pdf' }, 'x');
    expect(
      (await getFile(filesApp(fetchImpl), alice.cookie, fileParams('nobody@zilar.localhost')))
        .status,
    ).toBe(404);
    const { status, json } = await getFile(
      filesApp(fetchImpl),
      alice.cookie,
      fileParams(dmJid(stranger.id)),
    );
    expect(status).toBe(404);
    expect(errorCode(json)).toBe('not_found');
  });

  it('answers 404 for a URL not in that chat', async () => {
    const { alice, bob } = await setupDm();
    const carol = await contactOf(context, app, alice.id, 'carol@example.com');
    const own = localpartFor(alice.id);
    const peer = dmJid(bob.id);
    await seedArchive(archiveClient, [
      {
        owner: own,
        peer: `${peer}/r1`,
        barePeer: peer,
        kind: 'chat',
        nick: '',
        originId: 'o-doc',
        timestamp: at('2026-05-01T00:00:00.000Z'),
        txt: '',
        xml: payloadMessage(DOC, undefined, `${peer}/phone`),
      },
    ]);
    const { fetchImpl, calls } = makeFetch(
      200,
      { 'content-type': 'application/pdf' },
      'hello-bytes',
    );
    const { status, json } = await getFile(
      filesApp(fetchImpl),
      alice.cookie,
      fileParams(dmJid(carol.id)),
    );
    expect(status).toBe(404);
    expect(errorCode(json)).toBe('not_found');
    expect(calls).toEqual([]);
  });

  it('answers 404 for a retracted row', async () => {
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
        originId: 'o-doc',
        timestamp: at('2026-05-01T00:00:00.000Z'),
        txt: '',
        xml: payloadMessage(DOC, undefined, `${peer}/phone`),
      },
      {
        owner: own,
        peer: `${peer}/r1`,
        barePeer: peer,
        kind: 'chat',
        nick: '',
        originId: 'o-retract',
        timestamp: at('2026-05-02T00:00:00.000Z'),
        txt: 'This person attempted to retract a previous message.',
        xml: `<message type="chat"><body>This person attempted to retract a previous message.</body><retract xmlns="urn:xmpp:message-retract:1" id="o-doc"/></message>`,
      },
    ]);
    const { fetchImpl, calls } = makeFetch(
      200,
      { 'content-type': 'application/pdf' },
      'hello-bytes',
    );
    const { status, json } = await getFile(filesApp(fetchImpl), alice.cookie, fileParams(peer));
    expect(status).toBe(404);
    expect(errorCode(json)).toBe('not_found');
    expect(calls).toEqual([]);
  });

  it('answers 404 for a blocked DM in either direction', async () => {
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
        originId: 'o-doc',
        timestamp: at('2026-05-01T00:00:00.000Z'),
        txt: '',
        xml: payloadMessage(DOC, undefined, `${peer}/phone`),
      },
    ]);
    const block = await app.request(`${TEST_BASE_URL}/api/blocks/${bob.id}`, {
      method: 'PUT',
      headers: { cookie: alice.cookie },
    });
    expect(block.status).toBe(200);

    const { fetchImpl } = makeFetch(200, { 'content-type': 'application/pdf' }, 'hello-bytes');
    const target = filesApp(fetchImpl);
    expect((await getFile(target, alice.cookie, fileParams(peer))).status).toBe(404);
    expect((await getFile(target, bob.cookie, fileParams(dmJid(alice.id)))).status).toBe(404);
  });

  it('serves a member the bytes with the content type and private caching', async () => {
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
        originId: 'o-doc',
        timestamp: at('2026-05-01T00:00:00.000Z'),
        txt: '',
        xml: payloadMessage(DOC, undefined, `${peer}/phone`),
      },
    ]);
    const { fetchImpl, calls } = makeFetch(
      200,
      { 'content-type': 'application/pdf' },
      'hello-bytes',
    );
    const { status, headers, text } = await getFile(
      filesApp(fetchImpl),
      alice.cookie,
      fileParams(peer),
    );
    expect(status).toBe(200);
    expect(text).toBe('hello-bytes');
    expect(headers.get('content-type')).toBe('application/pdf');
    expect(headers.get('cache-control')).toBe('private, max-age=3600');
    expect(headers.get('x-content-type-options')).toBe('nosniff');
    expect(headers.get('content-disposition')).toContain('attachment');
    expect(headers.get('content-disposition')).toContain('doc.pdf');
    expect(calls).toEqual([{ url: INTERNAL_URL, range: null }]);
  });

  it('encodes a tricky filename per RFC 5987', async () => {
    const { alice, bob } = await setupDm();
    const own = localpartFor(alice.id);
    const peer = dmJid(bob.id);
    await seedMediaItem(own, peer, 'o-tricky', "it's (1)*.pdf");
    const { fetchImpl } = makeFetch(200, { 'content-type': 'application/pdf' }, 'hello-bytes');
    const { status, headers } = await getFile(filesApp(fetchImpl), alice.cookie, fileParams(peer));
    expect(status).toBe(200);
    expect(headers.get('content-disposition')).toBe(
      "attachment; filename*=UTF-8''it%27s%20%281%29%2A.pdf",
    );
  });

  it('finds a just-sent file after the on-demand index', async () => {
    const { alice, bob } = await setupDm();
    const own = localpartFor(alice.id);
    const peer = dmJid(bob.id);
    // Archive row only: no mediaItems row exists before the request.
    await seedArchive(archiveClient, [
      {
        owner: own,
        peer: `${peer}/r1`,
        barePeer: peer,
        kind: 'chat',
        nick: '',
        originId: 'o-fresh',
        timestamp: at('2026-05-20T00:00:00.000Z'),
        txt: '',
        xml: payloadMessage(DOC, undefined, `${own}@${TEST_XMPP_DOMAIN}/desk`),
      },
    ]);
    const before = await testSql(context)(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        return yield* sql<{ id: string }>`SELECT id FROM media_items`;
      }),
    );
    expect(before).toEqual([]);
    const { fetchImpl } = makeFetch(200, { 'content-type': 'application/pdf' }, 'hello-bytes');
    const { status, text } = await getFile(filesApp(fetchImpl), alice.cookie, fileParams(peer));
    expect(status).toBe(200);
    expect(text).toBe('hello-bytes');
  });

  it('forwards a Range request and passes the 206 through', async () => {
    const { alice, bob } = await setupDm();
    const own = localpartFor(alice.id);
    const peer = dmJid(bob.id);
    await seedMediaItem(own, peer, 'o-doc', 'doc.pdf');
    const { fetchImpl, calls } = makeFetch(
      206,
      { 'content-type': 'application/pdf', 'content-range': 'bytes 0-3/11' },
      'hell',
    );
    const { status, headers, text } = await getFile(
      filesApp(fetchImpl),
      alice.cookie,
      fileParams(peer),
      { range: 'bytes=0-3' },
    );
    expect(status).toBe(206);
    expect(text).toBe('hell');
    expect(headers.get('content-range')).toBe('bytes 0-3/11');
    expect(calls).toEqual([{ url: INTERNAL_URL, range: 'bytes=0-3' }]);
  });

  it('serves a forwarded copy through the target chat but not the source chat', async () => {
    const { alice, bob } = await setupDm();
    const carol = await contactOf(context, app, alice.id, 'carol@example.com');
    const aliceOwn = localpartFor(alice.id);
    const bobOwn = localpartFor(bob.id);
    const bobPeer = dmJid(bob.id);
    const carolPeer = dmJid(carol.id);
    await seedArchive(archiveClient, [
      // The same URL in the target chat (alice-carol), visible to alice.
      {
        owner: aliceOwn,
        peer: `${carolPeer}/r1`,
        barePeer: carolPeer,
        kind: 'chat',
        nick: '',
        originId: 'o-forward',
        timestamp: at('2026-05-10T00:00:00.000Z'),
        txt: '',
        xml: payloadMessage(DOC, undefined, `${carolPeer}/phone`),
      },
      // The same URL in the source chat (bob-carol), which alice cannot see.
      {
        owner: bobOwn,
        peer: `${carolPeer}/r1`,
        barePeer: carolPeer,
        kind: 'chat',
        nick: '',
        originId: 'o-original',
        timestamp: at('2026-05-01T00:00:00.000Z'),
        txt: '',
        xml: payloadMessage(DOC, undefined, `${carolPeer}/phone`),
      },
    ]);
    const { fetchImpl, calls } = makeFetch(
      200,
      { 'content-type': 'application/pdf' },
      'hello-bytes',
    );
    const target = filesApp(fetchImpl);
    const throughTarget = await getFile(target, alice.cookie, fileParams(carolPeer));
    expect(throughTarget.status).toBe(200);
    expect(throughTarget.text).toBe('hello-bytes');
    const throughSource = await getFile(target, alice.cookie, fileParams(bobPeer));
    expect(throughSource.status).toBe(404);
    expect(calls).toEqual([{ url: INTERNAL_URL, range: null }]);
  });

  it('answers 502 when the upstream fails', async () => {
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
        originId: 'o-doc',
        timestamp: at('2026-05-01T00:00:00.000Z'),
        txt: '',
        xml: payloadMessage(DOC, undefined, `${peer}/phone`),
      },
    ]);
    const { fetchImpl } = makeFetch(500, { 'content-type': 'text/plain' }, 'boom');
    const { status, json } = await getFile(filesApp(fetchImpl), alice.cookie, fileParams(peer));
    expect(status).toBe(502);
    expect(errorCode(json)).toBe('file_unavailable');
  });

  it('answers 429 after 600 requests a minute', async () => {
    const { alice, bob } = await setupDm();
    const own = localpartFor(alice.id);
    const peer = dmJid(bob.id);
    await seedMediaItem(own, peer, 'o-doc', 'doc.pdf');
    const { fetchImpl } = makeFetch(200, { 'content-type': 'application/pdf' }, 'hello-bytes');
    const target = filesApp(fetchImpl);
    const params = fileParams(peer);
    for (let i = 0; i < 600; i += 1) {
      const { status } = await getFile(target, alice.cookie, params);
      expect(status).toBe(200);
    }
    const { status, json } = await getFile(target, alice.cookie, params);
    expect(status).toBe(429);
    expect(errorCode(json)).toBe('rate_limited');
  });
});
