// T-1429: a models.dev OpenAI-compatible provider can back a connection. The
// create route resolves its base URL from the server-only catalog map, refuses
// an id no catalog knows, and never accepts a client base URL for it. Its key
// probe runs through the pinned fetch, exactly like `openai-compatible`.
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Effect } from 'effect';
import { SqlClient } from 'effect/sql';
import { createApp } from '../app';
import { getAiCatalog, resetCatalogCache } from '../ai/catalog';
import { createKeyCipher, type KeyCipher } from './crypto';
import { createPinnedFetch } from './pinned-fetch';
import { createProviderProbe } from './probe';
import {
  bootstrapUser,
  createTestContext,
  TEST_BASE_URL,
  testSql,
  type SignedInUser,
  type TestContext,
} from '../test-support';

// No DNS in tests: the save-time check resolves every catalog host to one
// public address, so no test ever opens a socket.
vi.mock('./base-url', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./base-url')>();
  return { ...actual, resolvePublic: vi.fn(async () => '93.184.216.34') };
});

// The probe's pinned transport is stubbed per test, so the route is checked
// without a socket; the real `createPinnedFetch` is replaced only here.
vi.mock('./pinned-fetch', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./pinned-fetch')>();
  return { ...actual, createPinnedFetch: vi.fn() };
});

const MASTER_KEY = 'test-master-key-0000000000000000000000';
const CATALOG_ID = 'together';
const CATALOG_BASE_URL = 'https://api.together.xyz/v1';
const KEY = 'sk-catalog-key-do-not-leak';

const sample: unknown = JSON.parse(
  readFileSync(new URL('../ai/__fixtures__/models-dev-sample.json', import.meta.url), 'utf8'),
);

describe('a catalog provider connection', () => {
  let context: TestContext;
  let cipher: KeyCipher;
  let app: ReturnType<typeof createApp>;

  beforeEach(async () => {
    context = await createTestContext();
    cipher = createKeyCipher(MASTER_KEY);
    // Warm the server-only base URL map the create route reads (T-1429).
    resetCatalogCache();
    await getAiCatalog({
      fetchImpl: async () => new Response(JSON.stringify(sample), { status: 200 }),
    });
    // Any catalog load a test triggers stays offline: the fixture over the wire.
    vi.stubGlobal('fetch', () =>
      Promise.resolve(new Response(JSON.stringify(sample), { status: 200 })),
    );
    app = createApp({
      db: context.db,
      logger: context.logger,
      config: context.config,
      auth: context.auth,
      adminClient: context.adminClient,
      connections: { cipher },
    });
  });

  afterEach(async () => {
    vi.unstubAllGlobals();
    await context.close();
  });

  function create(user: SignedInUser, body: Record<string, unknown>): Promise<Response> {
    return app.request(`${TEST_BASE_URL}/api/connections`, {
      method: 'POST',
      headers: { cookie: user.cookie, 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
  }

  async function storedBaseUrl(connectionId: string): Promise<string | null> {
    const rows = await testSql(context)(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        return yield* sql<{ baseUrl: string | null }>`SELECT base_url AS "baseUrl"
          FROM provider_connections WHERE id = ${connectionId} LIMIT 1`;
      }),
    );
    return rows[0]?.baseUrl ?? null;
  }

  it('stores the catalog base URL, never a client one', async () => {
    const owner = await bootstrapUser(context, app, 'owner@example.com');

    const response = await create(owner, { provider: CATALOG_ID, key: KEY });

    expect(response.status).toBe(201);
    const body = (await response.json()) as {
      id: string;
      provider: string;
      baseUrl: string | null;
    };
    expect(body.provider).toBe(CATALOG_ID);
    expect(body.baseUrl).toBe(CATALOG_BASE_URL);
    expect(await storedBaseUrl(body.id)).toBe(CATALOG_BASE_URL);
  });

  it('loads the catalog on create when the base URL map is cold', async () => {
    const owner = await bootstrapUser(context, app, 'owner@example.com');
    // A fresh process: no cached catalog and no base URL map.
    resetCatalogCache();

    const response = await create(owner, { provider: CATALOG_ID, key: KEY });

    expect(response.status).toBe(201);
    const body = (await response.json()) as { id: string; baseUrl: string | null };
    expect(body.baseUrl).toBe(CATALOG_BASE_URL);
    expect(await storedBaseUrl(body.id)).toBe(CATALOG_BASE_URL);
  });

  it('answers 400 Unknown provider for an id no catalog knows', async () => {
    const owner = await bootstrapUser(context, app, 'owner@example.com');

    const response = await create(owner, { provider: 'not-a-real-provider', key: KEY });

    expect(response.status).toBe(400);
    expect(await response.text()).toContain('Unknown provider');
  });

  it('refuses a client base URL for a catalog provider', async () => {
    const owner = await bootstrapUser(context, app, 'owner@example.com');

    const response = await create(owner, {
      provider: CATALOG_ID,
      key: KEY,
      baseUrl: 'https://evil.example/v1',
    });

    expect(response.status).toBe(400);
  });

  it('probes a catalog provider through the pinned fetch', async () => {
    const fetchImpl = vi.fn(async () => new Response(null, { status: 200 }));
    vi.mocked(createPinnedFetch).mockReturnValue(fetchImpl);

    const outcome = await createProviderProbe().testKey(CATALOG_ID, KEY, CATALOG_BASE_URL);

    expect(outcome).toEqual({ ok: true });
    expect(vi.mocked(createPinnedFetch)).toHaveBeenCalledWith(CATALOG_BASE_URL);
    expect(fetchImpl).toHaveBeenCalledWith(
      `${CATALOG_BASE_URL}/models`,
      expect.objectContaining({ headers: { authorization: `Bearer ${KEY}` } }),
    );
  });
});
