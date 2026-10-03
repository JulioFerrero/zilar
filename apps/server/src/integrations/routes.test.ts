// Integration settings routes (T-0162 + the Email follow-up): the
// owner-only Telegram token and mail sender/key endpoints, plus the
// per-request token resolver the import route uses. A non-owner gets the
// same 404 as an unknown route everywhere; secrets never reach logs, audit
// rows or responses (sentinel tests below). No test touches real Telegram
// or real mail: the client and the test send are injected.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { createAuditRecorder } from '../audit/service';
import { CurrentMailer } from '../auth/mailer';
import { createApp } from '../app';
import { auditLog, instanceSettings } from '../db/schema';
import {
  bootstrapUser,
  contactOf,
  createTestContext,
  TEST_BASE_URL,
  type SignedInUser,
  type TestContext,
} from '../test-support';
import {
  INTEGRATIONS_EMAIL_RATE_LIMIT_MAX,
  INTEGRATIONS_TELEGRAM_RATE_LIMIT_MAX,
  createGetBotToken,
  createIntegrationsRoutes,
  type IntegrationsRoutesDependencies,
} from './routes';
import { getStoredTelegramToken, TELEGRAM_BOT_TOKEN_SETTING } from './settings';
import { MAIL_FROM_SETTING, RESEND_API_KEY_SETTING, settingsCipherFor } from '../setup/settings';
import type { TelegramClient } from '../stickers/telegram-import';
import { TelegramImportError } from '../stickers/telegram-import';

const SENTINEL_TOKEN = 'SENTINEL_TELEGRAM_BOT_TOKEN_9f8e7d6c5b4a';
const SENTINEL_KEY = 're_SENTINEL_RESEND_KEY_9f8e7d6c5b4a';
const SENTINEL_FROM = 'Zilar <sentinel-sender@example.com>';

let context: TestContext;
let owner: SignedInUser;
let stranger: SignedInUser;
let liveMailer: CurrentMailer;
let sentTo: string[];

function acceptingTelegramClient(): TelegramClient {
  return {
    getMe: async () => ({ ok: true }),
    getStickerSet: async () => {
      throw new TelegramImportError('pack_not_found', 'That Telegram sticker pack was not found');
    },
    downloadFile: async () => new Uint8Array(),
  };
}

function rejectingTelegramClient(): TelegramClient {
  return {
    getMe: async () => {
      throw new TelegramImportError('invalid_token', 'Telegram rejected the bot token');
    },
    getStickerSet: async () => {
      throw new TelegramImportError('invalid_token', 'Telegram rejected the bot token');
    },
    downloadFile: async () => new Uint8Array(),
  };
}

function appFor(overrides: Partial<IntegrationsRoutesDependencies> = {}) {
  return createApp({
    db: context.db,
    logger: context.logger,
    config: context.config,
    auth: context.auth,
    adminClient: context.adminClient,
    mailer: liveMailer,
    audit: createAuditRecorder({ db: context.db, logger: context.logger }),
    integrations: {
      createTelegram: () => acceptingTelegramClient(),
      sendTestMail: async ({ email }) => {
        sentTo.push(email);
      },
      swapMailer: (mailer) => {
        liveMailer.use(mailer);
      },
      ...overrides,
    },
  });
}

async function jsonRequest(
  app: ReturnType<typeof createApp>,
  method: string,
  path: string,
  user: SignedInUser,
  body?: unknown,
): Promise<Response> {
  return app.request(`${TEST_BASE_URL}${path}`, {
    method,
    headers: { cookie: user.cookie, 'content-type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

beforeEach(async () => {
  context = await createTestContext();
  liveMailer = new CurrentMailer(context.mailer);
  sentTo = [];
  const boot = appFor();
  owner = await bootstrapUser(context, boot, 'owner@example.com');
  stranger = await contactOf(context, boot, owner.id, 'stranger@example.com');
});

afterEach(async () => {
  await context.close();
});

describe('GET /api/settings/integrations', () => {
  it('a non-owner gets the same 404 as an unknown route', async () => {
    const app = appFor();
    const response = await jsonRequest(app, 'GET', '/api/settings/integrations', stranger);
    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({ error: { code: 'not_found' } });
  });

  it('the owner reads empty state before anything is stored', async () => {
    const app = appFor();
    const response = await jsonRequest(app, 'GET', '/api/settings/integrations', owner);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      telegram: { configured: false, source: null },
      email: { configured: true, source: 'env', from: null },
      voiceTranscription: { configured: false, baseUrl: null, model: null },
      canManage: true,
    });
  });

  it('answers 401 without a session (authz sweep covers the rest)', async () => {
    const app = appFor();
    const response = await app.request(`${TEST_BASE_URL}/api/settings/integrations`);
    expect(response.status).toBe(401);
  });
});

describe('PUT /api/settings/integrations/telegram', () => {
  it('the owner saves a valid token; the stored value is encrypted', async () => {
    const app = appFor();
    const response = await jsonRequest(app, 'PUT', '/api/settings/integrations/telegram', owner, {
      botToken: SENTINEL_TOKEN,
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });

    const stored = await getStoredTelegramToken(context.db, settingsCipherFor(context.config));
    expect(stored).toBe(SENTINEL_TOKEN);
    const [row] = await context.db
      .select()
      .from(instanceSettings)
      .where(eq(instanceSettings.key, TELEGRAM_BOT_TOKEN_SETTING));
    expect(row?.value).not.toContain(SENTINEL_TOKEN);

    const status = (await (
      await jsonRequest(app, 'GET', '/api/settings/integrations', owner)
    ).json()) as { telegram: { configured: boolean; source: string | null } };
    expect(status.telegram).toEqual({ configured: true, source: 'stored' });
  });

  it('an invalid token is refused with 422 and nothing is stored', async () => {
    const app = appFor({ createTelegram: () => rejectingTelegramClient() });
    const response = await jsonRequest(app, 'PUT', '/api/settings/integrations/telegram', owner, {
      botToken: 'bad-token',
    });
    expect(response.status).toBe(422);
    const raw = await response.text();
    expect(JSON.parse(raw)).toMatchObject({ error: { code: 'invalid_token' } });
    expect(raw).not.toContain('bad-token');
    expect(await getStoredTelegramToken(context.db, settingsCipherFor(context.config))).toBeNull();
  });

  it('env wins: the status reads from env even with a stored token', async () => {
    const envApp = createApp({
      db: context.db,
      logger: context.logger,
      config: { ...context.config, TELEGRAM_BOT_TOKEN: 'env-token-value' },
      auth: context.auth,
      adminClient: context.adminClient,
      mailer: liveMailer,
      integrations: { createTelegram: () => acceptingTelegramClient() },
    });
    await jsonRequest(envApp, 'PUT', '/api/settings/integrations/telegram', owner, {
      botToken: SENTINEL_TOKEN,
    });
    const status = (await (
      await jsonRequest(envApp, 'GET', '/api/settings/integrations', owner)
    ).json()) as { telegram: { configured: boolean; source: string | null } };
    expect(status.telegram).toEqual({ configured: true, source: 'env' });

    // And the resolver hands the env token to the import route.
    const resolve = createGetBotToken({
      config: { TELEGRAM_BOT_TOKEN: 'env-token-value' },
      db: context.db,
      cipher: settingsCipherFor(context.config),
    });
    await expect(resolve()).resolves.toBe('env-token-value');
  });

  it('the resolver reads the stored token when env is unset, else null', async () => {
    const app = appFor();
    await jsonRequest(app, 'PUT', '/api/settings/integrations/telegram', owner, {
      botToken: SENTINEL_TOKEN,
    });
    const resolve = createGetBotToken({
      config: context.config,
      db: context.db,
      cipher: settingsCipherFor(context.config),
    });
    await expect(resolve()).resolves.toBe(SENTINEL_TOKEN);

    const emptyContext = context;
    void emptyContext;
    const fresh = await createTestContext();
    try {
      const resolveEmpty = createGetBotToken({
        config: fresh.config,
        db: fresh.db,
        cipher: settingsCipherFor(fresh.config),
      });
      await expect(resolveEmpty()).resolves.toBeNull();
    } finally {
      await fresh.close();
    }
  });

  it('a non-owner gets the same 404 on PUT and DELETE', async () => {
    const app = appFor();
    expect(
      (
        await jsonRequest(app, 'PUT', '/api/settings/integrations/telegram', stranger, {
          botToken: 'x',
        })
      ).status,
    ).toBe(404);
    expect(
      (await jsonRequest(app, 'DELETE', '/api/settings/integrations/telegram', stranger)).status,
    ).toBe(404);
  });

  it('rejects bad bodies without calling Telegram', async () => {
    let calls = 0;
    const app = appFor({
      createTelegram: () => {
        calls += 1;
        return acceptingTelegramClient();
      },
    });
    for (const body of [
      {},
      { botToken: '' },
      { botToken: 'has space' },
      { botToken: 'x'.repeat(257) },
      null,
    ]) {
      const response = await jsonRequest(
        app,
        'PUT',
        '/api/settings/integrations/telegram',
        owner,
        body,
      );
      expect(response.status).toBe(400);
    }
    expect(calls).toBe(0);
  });

  it('rate limits 10 per 10 minutes per user', async () => {
    const app = appFor();
    for (let attempt = 0; attempt < INTEGRATIONS_TELEGRAM_RATE_LIMIT_MAX; attempt += 1) {
      const response = await jsonRequest(app, 'PUT', '/api/settings/integrations/telegram', owner, {
        botToken: SENTINEL_TOKEN,
      });
      expect(response.status).toBe(200);
    }
    const limited = await jsonRequest(app, 'PUT', '/api/settings/integrations/telegram', owner, {
      botToken: SENTINEL_TOKEN,
    });
    expect(limited.status).toBe(429);
  });

  it('removing the token does not use up the save budget', async () => {
    const app = appFor();
    for (let attempt = 0; attempt < INTEGRATIONS_TELEGRAM_RATE_LIMIT_MAX + 3; attempt += 1) {
      const removed = await jsonRequest(
        app,
        'DELETE',
        '/api/settings/integrations/telegram',
        owner,
      );
      expect(removed.status).toBe(200);
    }
    const saved = await jsonRequest(app, 'PUT', '/api/settings/integrations/telegram', owner, {
      botToken: SENTINEL_TOKEN,
    });
    expect(saved.status).toBe(200);
  });

  it('the owner removes the stored token; the env value stays in effect', async () => {
    const app = appFor();
    await jsonRequest(app, 'PUT', '/api/settings/integrations/telegram', owner, {
      botToken: SENTINEL_TOKEN,
    });
    const removed = await jsonRequest(app, 'DELETE', '/api/settings/integrations/telegram', owner);
    expect(removed.status).toBe(200);
    expect(await getStoredTelegramToken(context.db, settingsCipherFor(context.config))).toBeNull();
    const status = (await (
      await jsonRequest(app, 'GET', '/api/settings/integrations', owner)
    ).json()) as { telegram: { configured: boolean; source: string | null } };
    expect(status.telegram).toEqual({ configured: false, source: null });
  });

  it('the token never reaches logs, audit rows or responses', async () => {
    const app = appFor();
    await jsonRequest(app, 'PUT', '/api/settings/integrations/telegram', owner, {
      botToken: SENTINEL_TOKEN,
    });
    await jsonRequest(app, 'DELETE', '/api/settings/integrations/telegram', owner);
    expect(context.logOutput()).not.toContain(SENTINEL_TOKEN);

    const rows = await context.db
      .select()
      .from(auditLog)
      .where(eq(auditLog.action, 'integrations.telegram_set'));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.detail).toBeNull();
    expect(JSON.stringify(rows[0])).not.toContain(SENTINEL_TOKEN);
    const removed = await context.db
      .select()
      .from(auditLog)
      .where(eq(auditLog.action, 'integrations.telegram_removed'));
    expect(removed).toHaveLength(1);
    expect(JSON.stringify(removed[0])).not.toContain(SENTINEL_TOKEN);
  });
});

describe('PUT /api/settings/integrations/email', () => {
  function storedApp(overrides: Partial<IntegrationsRoutesDependencies> = {}) {
    return createApp({
      db: context.db,
      logger: context.logger,
      config: { ...context.config, MAIL_TRANSPORT: undefined },
      auth: context.auth,
      adminClient: context.adminClient,
      mailer: liveMailer,
      audit: createAuditRecorder({ db: context.db, logger: context.logger }),
      integrations: {
        createTelegram: () => acceptingTelegramClient(),
        sendTestMail: async ({ email }) => {
          sentTo.push(email);
        },
        swapMailer: (mailer) => {
          liveMailer.use(mailer);
        },
        ...overrides,
      },
    });
  }

  it('a non-owner gets the same 404 on PUT', async () => {
    const app = storedApp();
    const response = await jsonRequest(app, 'PUT', '/api/settings/integrations/email', stranger, {
      from: SENTINEL_FROM,
    });
    expect(response.status).toBe(404);
  });

  it('the owner saves the sender with a new key after a test mail', async () => {
    const app = storedApp();
    const response = await jsonRequest(app, 'PUT', '/api/settings/integrations/email', owner, {
      from: SENTINEL_FROM,
      resendApiKey: SENTINEL_KEY,
    });
    expect(response.status).toBe(200);
    // The test mail went to the owner's own address.
    expect(sentTo).toEqual(['owner@example.com']);
    // The key is stored encrypted, the sender in clear.
    const rows = await context.db.select().from(instanceSettings);
    const byKey = new Map(rows.map((row) => [row.key, row.value]));
    expect(byKey.get(RESEND_API_KEY_SETTING)).not.toContain(SENTINEL_KEY);
    expect(byKey.get(MAIL_FROM_SETTING)).toBe(SENTINEL_FROM);
    const status = (await (
      await jsonRequest(app, 'GET', '/api/settings/integrations', owner)
    ).json()) as { email: { configured: boolean; source: string | null; from: string | null } };
    expect(status.email).toEqual({ configured: true, source: 'stored', from: SENTINEL_FROM });
  });

  it('saving only the sender keeps the stored key', async () => {
    const app = storedApp();
    await jsonRequest(app, 'PUT', '/api/settings/integrations/email', owner, {
      from: SENTINEL_FROM,
      resendApiKey: SENTINEL_KEY,
    });
    sentTo.length = 0;
    const next = 'Zilar <next-sender@example.com>';
    const response = await jsonRequest(app, 'PUT', '/api/settings/integrations/email', owner, {
      from: next,
    });
    expect(response.status).toBe(200);
    expect(sentTo).toEqual(['owner@example.com']);
    const rows = await context.db.select().from(instanceSettings);
    const byKey = new Map(rows.map((row) => [row.key, row.value]));
    expect(byKey.get(MAIL_FROM_SETTING)).toBe(next);
    // The encrypted blob still decrypts to the original key.
    const { getMailSettings } = await import('../setup/settings');
    const stored = await getMailSettings(context.db, settingsCipherFor(context.config));
    expect(stored).toEqual({ resendApiKey: SENTINEL_KEY, from: next });
  });

  it('a failed test send answers 422 and stores nothing', async () => {
    const app = storedApp({
      sendTestMail: async () => {
        throw new Error('535 rejected: bad key');
      },
    });
    const response = await jsonRequest(app, 'PUT', '/api/settings/integrations/email', owner, {
      from: SENTINEL_FROM,
      resendApiKey: SENTINEL_KEY,
    });
    expect(response.status).toBe(422);
    const raw = await response.text();
    expect(JSON.parse(raw)).toMatchObject({ error: { code: 'mail_send_failed' } });
    expect(raw).not.toContain(SENTINEL_KEY);
    expect(raw).not.toContain('535');
    const rows = await context.db.select().from(instanceSettings);
    expect(rows).toHaveLength(0);
  });

  it('while mail comes from env the PUT answers 409 managed_by_environment', async () => {
    const app = appFor();
    const response = await jsonRequest(app, 'PUT', '/api/settings/integrations/email', owner, {
      from: SENTINEL_FROM,
    });
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: { code: 'managed_by_environment' } });
  });

  it('rejects bad bodies without sending a test mail', async () => {
    const app = storedApp();
    for (const body of [
      {},
      { from: '' },
      { from: 'not-an-address' },
      { from: SENTINEL_FROM, resendApiKey: '' },
      null,
    ]) {
      const response = await jsonRequest(
        app,
        'PUT',
        '/api/settings/integrations/email',
        owner,
        body,
      );
      expect(response.status).toBe(400);
    }
    expect(sentTo).toHaveLength(0);
  });

  it('rate limits 5 per 10 minutes per user', async () => {
    const app = storedApp();
    for (let attempt = 0; attempt < INTEGRATIONS_EMAIL_RATE_LIMIT_MAX; attempt += 1) {
      const response = await jsonRequest(app, 'PUT', '/api/settings/integrations/email', owner, {
        from: SENTINEL_FROM,
        resendApiKey: SENTINEL_KEY,
      });
      expect(response.status).toBe(200);
    }
    const limited = await jsonRequest(app, 'PUT', '/api/settings/integrations/email', owner, {
      from: SENTINEL_FROM,
    });
    expect(limited.status).toBe(429);
  });

  it('the key and the owner email never reach logs, audit rows or responses', async () => {
    const app = storedApp();
    const response = await jsonRequest(app, 'PUT', '/api/settings/integrations/email', owner, {
      from: SENTINEL_FROM,
      resendApiKey: SENTINEL_KEY,
    });
    expect(response.status).toBe(200);
    const raw = await response.text();
    expect(raw).not.toContain(SENTINEL_KEY);
    expect(context.logOutput()).not.toContain(SENTINEL_KEY);
    expect(context.logOutput()).not.toContain('owner@example.com');

    const rows = await context.db
      .select()
      .from(auditLog)
      .where(eq(auditLog.action, 'integrations.email_set'));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.detail).toBeNull();
    const serialised = JSON.stringify(rows[0]);
    expect(serialised).not.toContain(SENTINEL_KEY);
    expect(serialised).not.toContain(SENTINEL_FROM);
    expect(serialised).not.toContain('owner@example.com');
  });
});

describe('integrations route shape', () => {
  it('registers exactly GET, PUT/DELETE telegram and PUT email under /api/settings/integrations', () => {
    const sub = createIntegrationsRoutes({
      auth: context.auth,
      db: context.db,
      config: context.config,
      logger: context.logger,
      mailer: liveMailer,
    });
    const paths = sub.routes.map((route) => `${route.method}|${route.path}`);
    expect(paths).toContain('GET|/settings/integrations');
    expect(paths).toContain('PUT|/settings/integrations/telegram');
    expect(paths).toContain('DELETE|/settings/integrations/telegram');
    expect(paths).toContain('PUT|/settings/integrations/email');
    expect(paths).toHaveLength(4);
  });
});
