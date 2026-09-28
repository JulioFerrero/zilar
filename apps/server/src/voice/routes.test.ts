import { writeFile } from 'node:fs/promises';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../app';
import { INVITE_HEADER } from '../auth/auth';
import { createInvite } from '../auth/invites';
import { createTestContext, type TestContext } from '../test-support';
import { NotAudioError, type ProbedAudio, type VoiceEngine } from './engine';

const BASE_URL = 'http://localhost:3000';
const CONVERTED = new Uint8Array([0x4d, 0x34, 0x41, 0x20]);

class FakeEngine implements VoiceEngine {
  /** Browser containers often carry no duration; the converted file does. */
  inputProbed: ProbedAudio = { formatName: 'matroska,webm' };
  outputProbed: ProbedAudio = { durationMs: 1234, formatName: 'mov,mp4,m4a,3gp,3g2,mj2' };
  probeError: Error | undefined;
  readonly conversions: Array<{ inputPath: string; outputPath: string }> = [];

  probe(inputPath: string): Promise<ProbedAudio> {
    if (this.probeError !== undefined) {
      return Promise.reject(this.probeError);
    }
    return Promise.resolve(inputPath.endsWith('output.m4a') ? this.outputProbed : this.inputProbed);
  }

  async convert(inputPath: string, outputPath: string): Promise<void> {
    await writeFile(outputPath, CONVERTED);
    this.conversions.push({ inputPath, outputPath });
  }
}

type TestApp = ReturnType<typeof createApp>;

function appFor(context: TestContext, engine: VoiceEngine, maxBytes?: number): TestApp {
  return createApp({
    db: context.db,
    logger: context.logger,
    config: context.config,
    auth: context.auth,
    adminClient: context.adminClient,
    voice: engine,
    ...(maxBytes === undefined ? {} : { voiceMaxBytes: maxBytes }),
  });
}

let ipCounter = 0;

async function signIn(context: TestContext, app: TestApp): Promise<string> {
  ipCounter += 1;
  const email = `voice-${ipCounter}@galena.test`;
  const invite = await createInvite(context.db, { createdBy: null });
  const headers = {
    'content-type': 'application/json',
    'x-forwarded-for': `10.9.${ipCounter}.1`,
    [INVITE_HEADER]: invite.code,
  };
  await app.request(`${BASE_URL}/api/auth/email-otp/send-verification-otp`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ email, type: 'sign-in' }),
  });
  const otp = context.mailer.codeFor(email);
  const response = await app.request(`${BASE_URL}/api/auth/sign-in/email-otp`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ email, otp }),
  });
  return response.headers.get('set-auth-token') ?? '';
}

describe('POST /api/voice', () => {
  let context: TestContext;
  let engine: FakeEngine;

  beforeEach(async () => {
    context = await createTestContext();
    engine = new FakeEngine();
  });

  afterEach(async () => {
    await context.close();
  });

  it('converts an audio upload and returns the ffprobe duration and the bytes', async () => {
    const app = appFor(context, engine);
    const bearer = await signIn(context, app);
    const response = await app.request(`${BASE_URL}/api/voice`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${bearer}`,
        'content-type': 'audio/webm',
        // A client-reported duration must never be trusted.
        'x-galena-duration-ms': '999999',
      },
      body: new Uint8Array([1, 2, 3, 4, 5]),
    });

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('audio/mp4');
    // The input container had no duration; this is the converted file's.
    expect(engine.inputProbed.durationMs).toBeUndefined();
    expect(response.headers.get('x-galena-duration-ms')).toBe('1234');
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(CONVERTED);
    expect(engine.conversions).toHaveLength(1);
  });

  it('rejects a non-audio upload with 415', async () => {
    engine.probeError = new NotAudioError('the upload is not audio-only');
    const app = appFor(context, engine);
    const bearer = await signIn(context, app);
    const response = await app.request(`${BASE_URL}/api/voice`, {
      method: 'POST',
      headers: { authorization: `Bearer ${bearer}`, 'content-type': 'text/plain' },
      body: 'this is not a recording',
    });

    expect(response.status).toBe(415);
    const body = (await response.json()) as { error: { code: string } };
    expect(body.error.code).toBe('voice_not_audio');
    expect(engine.conversions).toHaveLength(0);
  });

  it('rejects a recording longer than the duration cap', async () => {
    engine.inputProbed = { durationMs: 10 * 60 * 1000, formatName: 'webm' };
    const app = appFor(context, engine);
    const bearer = await signIn(context, app);
    const response = await app.request(`${BASE_URL}/api/voice`, {
      method: 'POST',
      headers: { authorization: `Bearer ${bearer}`, 'content-type': 'audio/ogg' },
      body: new Uint8Array([1, 2, 3]),
    });

    expect(response.status).toBe(422);
    expect(engine.conversions).toHaveLength(0);
  });

  it('rejects an empty upload with 400', async () => {
    const app = appFor(context, engine);
    const bearer = await signIn(context, app);
    const response = await app.request(`${BASE_URL}/api/voice`, {
      method: 'POST',
      headers: { authorization: `Bearer ${bearer}`, 'content-type': 'audio/webm' },
      body: new Uint8Array(),
    });

    expect(response.status).toBe(400);
  });

  it('requires a signed-in user', async () => {
    const app = appFor(context, engine);
    const response = await app.request(`${BASE_URL}/api/voice`, {
      method: 'POST',
      body: new Uint8Array([1, 2, 3]),
    });
    expect(response.status).toBe(401);
  });

  it('rejects an upload larger than the size cap', async () => {
    const app = appFor(context, engine, 8);
    const bearer = await signIn(context, app);
    const response = await app.request(`${BASE_URL}/api/voice`, {
      method: 'POST',
      headers: { authorization: `Bearer ${bearer}`, 'content-type': 'audio/webm' },
      body: new Uint8Array(64),
    });

    expect(response.status).toBe(413);
    const body = (await response.json()) as { error: { code: string } };
    expect(body.error.code).toBe('voice_too_large');
  });
});
