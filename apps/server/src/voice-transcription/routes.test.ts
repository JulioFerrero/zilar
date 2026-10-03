// Voice transcripts on demand (T-0170): the enabled flag, the cached
// transcript route with its advisory-lock single-flight, and the
// owner-only endpoint settings (verified with the silent WAV before
// storing). No test touches a real endpoint or key: the audio fetcher and
// the transcriber are injected, and the provider call count proves the
// cache (including two requests at once).

import { createHash } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { createAuditRecorder } from '../audit/service';
import { createApp } from '../app';
import { auditLog, instanceSettings, voiceTranscripts } from '../db/schema';
import {
  bootstrapUser,
  contactOf,
  createTestContext,
  TEST_BASE_URL,
  type SignedInUser,
  type TestContext,
} from '../test-support';
import {
  VOICE_TRANSCRIPT_RATE_LIMIT_MAX,
  type VoiceTranscriptionRoutesDependencies,
} from './routes';
import { getVoiceTranscriptionSettings, VOICE_TRANSCRIPTION_BASE_URL_SETTING } from './settings';
import { settingsCipherFor } from '../setup/settings';
import { TranscriptionProviderError } from './provider';

const SENTINEL_KEY = 'SENTINEL_TRANSCRIPT_KEY_9f8e7d6c5b4a';
const SENTINEL_BASE = 'https://transcribe.example.com/v1';
const SENTINEL_URL = 'http://localhost:3000/upload/voice/clip-1.m4a';
const SENTINEL_TEXT = 'SENTINEL transcript words here';

let context: TestContext;
let owner: SignedInUser;
let stranger: SignedInUser;

interface FakeProvider {
  calls: number;
  text: string;
  fail: boolean;
  lastForm?: { baseUrl: string; apiKey: string | null; model: string } | undefined;
}

function fakeProvider(fake: FakeProvider): VoiceTranscriptionRoutesDependencies['transcribe'] {
  return async (input) => {
    fake.calls += 1;
    fake.lastForm = { baseUrl: input.baseUrl, apiKey: input.apiKey, model: input.model };
    if (fake.fail) {
      throw new TranscriptionProviderError();
    }
    return { text: fake.text, language: 'en' };
  };
}

function appFor(fake: FakeProvider, overrides: Partial<VoiceTranscriptionRoutesDependencies> = {}) {
  return createApp({
    db: context.db,
    logger: context.logger,
    config: context.config,
    auth: context.auth,
    adminClient: context.adminClient,
    audit: createAuditRecorder({ db: context.db, logger: context.logger }),
    voiceTranscription: {
      audioFetcher: async () => ({ body: new Uint8Array([1, 2, 3, 4]), contentType: 'audio/mp4' }),
      transcribe: fakeProvider(fake),
      ...overrides,
    },
  });
}

async function jsonRequest(
  app: ReturnType<typeof createApp>,
  method: string,
  path: string,
  user: SignedInUser | null,
  body?: unknown,
): Promise<Response> {
  return app.request(`${TEST_BASE_URL}${path}`, {
    method,
    headers: {
      ...(user === null ? {} : { cookie: user.cookie }),
      'content-type': 'application/json',
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

async function configureOwner(app: ReturnType<typeof createApp>): Promise<Response> {
  return jsonRequest(app, 'PUT', '/api/settings/integrations/voice-transcription', owner, {
    baseUrl: SENTINEL_BASE,
    apiKey: SENTINEL_KEY,
    model: 'whisper-1',
  });
}

beforeEach(async () => {
  context = await createTestContext();
  const boot = createApp({
    db: context.db,
    logger: context.logger,
    config: context.config,
    auth: context.auth,
    adminClient: context.adminClient,
  });
  owner = await bootstrapUser(context, boot, 'owner@example.com');
  stranger = await contactOf(context, boot, owner.id, 'stranger@example.com');
});

afterEach(async () => {
  await context.close();
});

describe('GET /api/voice/transcription', () => {
  it('answers 401 without a session', async () => {
    const app = appFor({ calls: 0, text: SENTINEL_TEXT, fail: false });
    expect((await jsonRequest(app, 'GET', '/api/voice/transcription', null)).status).toBe(401);
  });

  it('says disabled with nothing configured', async () => {
    const app = appFor({ calls: 0, text: SENTINEL_TEXT, fail: false });
    const response = await jsonRequest(app, 'GET', '/api/voice/transcription', stranger);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ enabled: false });
  });

  it('says enabled after the owner configures an endpoint', async () => {
    const fake: FakeProvider = { calls: 0, text: SENTINEL_TEXT, fail: false };
    const app = appFor(fake);
    expect((await configureOwner(app)).status).toBe(200);
    fake.calls = 0;
    expect(
      await (await jsonRequest(app, 'GET', '/api/voice/transcription', stranger)).json(),
    ).toEqual({
      enabled: true,
    });
  });
});

describe('POST /api/voice/transcript', () => {
  it('answers 401 without a session', async () => {
    const app = appFor({ calls: 0, text: SENTINEL_TEXT, fail: false });
    expect(
      (await jsonRequest(app, 'POST', '/api/voice/transcript', null, { url: SENTINEL_URL })).status,
    ).toBe(401);
  });

  it('answers 501 with nothing configured', async () => {
    const app = appFor({ calls: 0, text: SENTINEL_TEXT, fail: false });
    const response = await jsonRequest(app, 'POST', '/api/voice/transcript', stranger, {
      url: SENTINEL_URL,
    });
    expect(response.status).toBe(501);
    expect(await response.json()).toMatchObject({
      error: { code: 'transcription_not_configured' },
    });
  });

  it('transcribes once and serves the cached text to a second tap and another user', async () => {
    const fake: FakeProvider = { calls: 0, text: SENTINEL_TEXT, fail: false };
    const app = appFor(fake);
    expect((await configureOwner(app)).status).toBe(200);
    fake.calls = 0;

    const first = await jsonRequest(app, 'POST', '/api/voice/transcript', stranger, {
      url: SENTINEL_URL,
    });
    expect(first.status).toBe(200);
    expect(await first.json()).toEqual({ text: SENTINEL_TEXT });

    const second = await jsonRequest(app, 'POST', '/api/voice/transcript', stranger, {
      url: SENTINEL_URL,
    });
    expect(second.status).toBe(200);
    expect(await second.json()).toEqual({ text: SENTINEL_TEXT });

    const otherUser = await jsonRequest(app, 'POST', '/api/voice/transcript', owner, {
      url: SENTINEL_URL,
    });
    expect(otherUser.status).toBe(200);
    expect(await otherUser.json()).toEqual({ text: SENTINEL_TEXT });

    expect(fake.calls).toBe(1);

    const hash = createHash('sha256').update(SENTINEL_URL, 'utf8').digest('hex');
    const [row] = await context.db
      .select()
      .from(voiceTranscripts)
      .where(eq(voiceTranscripts.urlHash, hash));
    expect(row?.text).toBe(SENTINEL_TEXT);
  });

  it('two requests at once cause a single provider call', async () => {
    const fake: FakeProvider = { calls: 0, text: SENTINEL_TEXT, fail: false };
    const app = appFor(fake);
    expect((await configureOwner(app)).status).toBe(200);
    fake.calls = 0;

    const [first, second] = await Promise.all([
      jsonRequest(app, 'POST', '/api/voice/transcript', stranger, { url: SENTINEL_URL }),
      jsonRequest(app, 'POST', '/api/voice/transcript', owner, { url: SENTINEL_URL }),
    ]);
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(await first.json()).toEqual({ text: SENTINEL_TEXT });
    expect(await second.json()).toEqual({ text: SENTINEL_TEXT });
    expect(fake.calls).toBe(1);
  });

  it('refuses a URL outside this install before any request is made', async () => {
    const fake: FakeProvider = { calls: 0, text: SENTINEL_TEXT, fail: false };
    let fetched = 0;
    const app = appFor(fake, {
      audioFetcher: async () => {
        fetched += 1;
        return { body: new Uint8Array([1]), contentType: 'audio/mp4' };
      },
    });
    expect((await configureOwner(app)).status).toBe(200);
    fake.calls = 0;

    for (const url of [
      'https://evil.example.com/upload/voice.m4a',
      'http://localhost:3000/avatar/x',
      'http://localhost:3000/upload/',
      'not a url',
      'http://localhost:9999/upload/voice.m4a',
    ]) {
      const response = await jsonRequest(app, 'POST', '/api/voice/transcript', stranger, { url });
      expect(response.status).toBe(400);
    }
    expect(fetched).toBe(0);
    expect(fake.calls).toBe(0);
  });

  it('refuses an oversized file with 413', async () => {
    const fake: FakeProvider = { calls: 0, text: SENTINEL_TEXT, fail: false };
    const app = appFor(fake, {
      audioFetcher: async () => ({
        body: new Uint8Array(10 * 1024 * 1024 + 1),
        contentType: 'audio/mp4',
      }),
    });
    expect((await configureOwner(app)).status).toBe(200);
    fake.calls = 0;
    const response = await jsonRequest(app, 'POST', '/api/voice/transcript', stranger, {
      url: SENTINEL_URL,
    });
    expect(response.status).toBe(413);
    expect(await response.json()).toMatchObject({ error: { code: 'voice_too_large' } });
    expect(fake.calls).toBe(0);
  });

  it('refuses a non-audio file with 422', async () => {
    const fake: FakeProvider = { calls: 0, text: SENTINEL_TEXT, fail: false };
    const app = appFor(fake, {
      audioFetcher: async () => ({ body: new Uint8Array([1, 2]), contentType: 'text/html' }),
    });
    expect((await configureOwner(app)).status).toBe(200);
    fake.calls = 0;
    const response = await jsonRequest(app, 'POST', '/api/voice/transcript', stranger, {
      url: SENTINEL_URL,
    });
    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({ error: { code: 'not_audio' } });
    expect(fake.calls).toBe(0);
  });

  it('a provider failure answers 502 with a fixed message and caches nothing', async () => {
    const good: FakeProvider = { calls: 0, text: SENTINEL_TEXT, fail: false };
    const setupApp = appFor(good);
    expect((await configureOwner(setupApp)).status).toBe(200);
    const fake: FakeProvider = { calls: 0, text: SENTINEL_TEXT, fail: true };
    const app = appFor(fake);
    const response = await jsonRequest(app, 'POST', '/api/voice/transcript', stranger, {
      url: SENTINEL_URL,
    });
    expect(response.status).toBe(502);
    const raw = await response.text();
    expect(JSON.parse(raw)).toMatchObject({ error: { code: 'transcription_failed' } });
    expect(raw).not.toContain(SENTINEL_KEY);
    const rows = await context.db.select().from(voiceTranscripts);
    expect(rows).toHaveLength(0);
  });

  it('rate limits 10 per 10 minutes per user', async () => {
    const fake: FakeProvider = { calls: 0, text: SENTINEL_TEXT, fail: false };
    const app = appFor(fake);
    expect((await configureOwner(app)).status).toBe(200);
    fake.calls = 0;
    for (let attempt = 0; attempt < VOICE_TRANSCRIPT_RATE_LIMIT_MAX; attempt += 1) {
      const response = await jsonRequest(app, 'POST', '/api/voice/transcript', stranger, {
        url: `${SENTINEL_URL}?n=${attempt}`,
      });
      expect(response.status).toBe(200);
    }
    const limited = await jsonRequest(app, 'POST', '/api/voice/transcript', stranger, {
      url: `${SENTINEL_URL}?n=over`,
    });
    expect(limited.status).toBe(429);
    expect(await limited.json()).toMatchObject({ error: { code: 'rate_limited' } });
  });

  it('the key, URL and text never reach logs, audit rows or errors', async () => {
    const fake: FakeProvider = { calls: 0, text: SENTINEL_TEXT, fail: false };
    const app = appFor(fake);
    expect((await configureOwner(app)).status).toBe(200);
    fake.calls = 0;
    const response = await jsonRequest(app, 'POST', '/api/voice/transcript', stranger, {
      url: SENTINEL_URL,
    });
    expect(response.status).toBe(200);
    expect(await response.text()).not.toContain(SENTINEL_KEY);
    expect(context.logOutput()).not.toContain(SENTINEL_KEY);
    expect(context.logOutput()).not.toContain(SENTINEL_TEXT);
    expect(context.logOutput()).not.toContain(SENTINEL_URL);

    const rows = await context.db
      .select()
      .from(auditLog)
      .where(eq(auditLog.action, 'voice.transcript_requested'));
    expect(rows).toHaveLength(1);
    const serialised = JSON.stringify(rows[0]);
    expect(serialised).not.toContain(SENTINEL_KEY);
    expect(serialised).not.toContain(SENTINEL_URL);
    expect(serialised).not.toContain(SENTINEL_TEXT);
    const hash = createHash('sha256').update(SENTINEL_URL, 'utf8').digest('hex');
    expect(serialised).toContain(hash);
  });
});

describe('PUT /api/settings/integrations/voice-transcription', () => {
  it('answers 401 without a session, and 404 for a non-owner', async () => {
    const app = appFor({ calls: 0, text: SENTINEL_TEXT, fail: false });
    expect(
      (
        await jsonRequest(app, 'PUT', '/api/settings/integrations/voice-transcription', null, {
          baseUrl: SENTINEL_BASE,
        })
      ).status,
    ).toBe(401);
    const denied = await jsonRequest(
      app,
      'PUT',
      '/api/settings/integrations/voice-transcription',
      stranger,
      { baseUrl: SENTINEL_BASE },
    );
    expect(denied.status).toBe(404);
    expect(await denied.json()).toMatchObject({ error: { code: 'not_found' } });
    expect(
      (await jsonRequest(app, 'DELETE', '/api/settings/integrations/voice-transcription', stranger))
        .status,
    ).toBe(404);
  });

  it('the owner saves a verified endpoint; the key is stored encrypted', async () => {
    const fake: FakeProvider = { calls: 0, text: SENTINEL_TEXT, fail: false };
    const app = appFor(fake);
    const response = await configureOwner(app);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    expect(fake.calls).toBe(1);
    expect(fake.lastForm).toEqual({
      baseUrl: SENTINEL_BASE,
      apiKey: SENTINEL_KEY,
      model: 'whisper-1',
    });

    const stored = await getVoiceTranscriptionSettings(
      context.db,
      settingsCipherFor(context.config),
    );
    expect(stored).toEqual({ baseUrl: SENTINEL_BASE, apiKey: SENTINEL_KEY, model: 'whisper-1' });
    const [row] = await context.db
      .select()
      .from(instanceSettings)
      .where(eq(instanceSettings.key, VOICE_TRANSCRIPTION_BASE_URL_SETTING));
    expect(row?.value).toBe(SENTINEL_BASE);

    const status = (await (
      await jsonRequest(app, 'GET', '/api/settings/integrations', owner)
    ).json()) as {
      voiceTranscription: { configured: boolean; baseUrl: string | null; model: string | null };
    };
    expect(status.voiceTranscription).toEqual({
      configured: true,
      baseUrl: SENTINEL_BASE,
      model: 'whisper-1',
    });
  });

  it('requires https unless localhost or a private address', async () => {
    const fake: FakeProvider = { calls: 0, text: SENTINEL_TEXT, fail: false };
    const app = appFor(fake);
    for (const baseUrl of ['http://transcribe.example.com/v1', 'ftp://x.example/y', 'nope']) {
      const response = await jsonRequest(
        app,
        'PUT',
        '/api/settings/integrations/voice-transcription',
        owner,
        { baseUrl },
      );
      expect(response.status).toBe(400);
    }
    for (const baseUrl of [
      'http://localhost:8080/v1',
      'http://127.0.0.1:8080/v1',
      'http://192.168.1.10:8080/v1',
    ]) {
      const response = await jsonRequest(
        app,
        'PUT',
        '/api/settings/integrations/voice-transcription',
        owner,
        { baseUrl },
      );
      expect(response.status).toBe(200);
    }
  });

  it('a rejected endpoint answers 422 and stores nothing', async () => {
    const fake: FakeProvider = { calls: 0, text: SENTINEL_TEXT, fail: true };
    const app = appFor(fake);
    const response = await configureOwner(app);
    expect(response.status).toBe(422);
    const raw = await response.text();
    expect(JSON.parse(raw)).toMatchObject({ error: { code: 'endpoint_rejected' } });
    expect(raw).not.toContain(SENTINEL_KEY);
    expect(raw).not.toContain(SENTINEL_BASE);
    expect(
      await getVoiceTranscriptionSettings(context.db, settingsCipherFor(context.config)),
    ).toBeNull();
    expect(await (await jsonRequest(app, 'GET', '/api/voice/transcription', owner)).json()).toEqual(
      {
        enabled: false,
      },
    );
  });

  it('an unreachable endpoint answers 422 endpoint_unreachable and stores nothing', async () => {
    const fake: FakeProvider = { calls: 0, text: SENTINEL_TEXT, fail: false };
    const app = appFor(fake, {
      transcribe: async () => {
        throw new Error('socket hangup');
      },
    });
    const response = await configureOwner(app);
    expect(response.status).toBe(422);
    const raw = await response.text();
    expect(JSON.parse(raw)).toMatchObject({ error: { code: 'endpoint_unreachable' } });
    expect(raw).not.toContain(SENTINEL_KEY);
    expect(
      await getVoiceTranscriptionSettings(context.db, settingsCipherFor(context.config)),
    ).toBeNull();
  });

  it('rejects bad bodies without calling the endpoint', async () => {
    const fake: FakeProvider = { calls: 0, text: SENTINEL_TEXT, fail: false };
    const app = appFor(fake);
    for (const body of [
      {},
      { baseUrl: '' },
      { baseUrl: SENTINEL_BASE, apiKey: '' },
      { baseUrl: SENTINEL_BASE, model: 'x'.repeat(129) },
      null,
    ]) {
      const response = await jsonRequest(
        app,
        'PUT',
        '/api/settings/integrations/voice-transcription',
        owner,
        body,
      );
      expect(response.status).toBe(400);
    }
    expect(fake.calls).toBe(0);
  });

  it('the owner removes the endpoint; DELETE never touches the rate budget', async () => {
    const fake: FakeProvider = { calls: 0, text: SENTINEL_TEXT, fail: false };
    const app = appFor(fake);
    expect((await configureOwner(app)).status).toBe(200);
    fake.calls = 0;
    const removed = await jsonRequest(
      app,
      'DELETE',
      '/api/settings/integrations/voice-transcription',
      owner,
    );
    expect(removed.status).toBe(200);
    expect(
      await getVoiceTranscriptionSettings(context.db, settingsCipherFor(context.config)),
    ).toBeNull();
    expect(await (await jsonRequest(app, 'GET', '/api/voice/transcription', owner)).json()).toEqual(
      {
        enabled: false,
      },
    );
  });

  it('the key never reaches logs, audit rows or responses', async () => {
    const fake: FakeProvider = { calls: 0, text: SENTINEL_TEXT, fail: false };
    const app = appFor(fake);
    expect((await configureOwner(app)).status).toBe(200);
    fake.calls = 0;
    await jsonRequest(app, 'DELETE', '/api/settings/integrations/voice-transcription', owner);
    expect(context.logOutput()).not.toContain(SENTINEL_KEY);

    const rows = await context.db
      .select()
      .from(auditLog)
      .where(eq(auditLog.action, 'integrations.voice_transcription_set'));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.detail).toBeNull();
    expect(JSON.stringify(rows[0])).not.toContain(SENTINEL_KEY);
    expect(JSON.stringify(rows[0])).not.toContain(SENTINEL_BASE);
  });
});
