import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createEjabberdAdminClient } from '../xmpp/admin-client';
import { loadXmppConfig, type XmppConfig } from '../xmpp/config';
import { issueXmppToken } from '../xmpp/token';
import { createFfmpegEngine, type VoiceEngine } from './engine';

// The xmpp-core package lives outside the server's project, so it is loaded at
// runtime instead of being compiled into this project (which has no ambient
// declarations for @xmpp/client). Only the surface this test uses is typed.
interface UploadSlotLike {
  putUrl: string;
  getUrl: string;
  headers: Record<string, string>;
}

interface VoiceXmppClient {
  status(): string;
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  requestUploadSlot(request: {
    filename: string;
    size: number;
    contentType: string;
  }): Promise<UploadSlotLike>;
}

interface XmppCoreModule {
  createXmppCore(options: {
    service: string;
    domain: string;
    getToken: () => Promise<{ jid: string; token: string }>;
  }): VoiceXmppClient;
}

async function loadXmppCore(): Promise<XmppCoreModule> {
  const specifier = new URL('../../../../packages/xmpp-core/src/index.ts', import.meta.url).href;
  return (await import(/* @vite-ignore */ specifier)) as XmppCoreModule;
}

// End-to-end voice check against the running dev stack. It converts a fixture
// with the real ffmpeg and then uploads/downloads it through the real ejabberd
// XEP-0363 upload service:
//
//   ZILAR_VOICE_INTEGRATION=1 pnpm --filter @zilar/server test
//
// It never starts or stops infrastructure; it uses the running one.
const enabled = process.env.ZILAR_VOICE_INTEGRATION === '1';
const SAMPLE_RATE = 8000;

function loadConfig(): XmppConfig {
  const envFile = fileURLToPath(new URL('../../../../infra/.env', import.meta.url));
  if (existsSync(envFile)) {
    process.loadEnvFile(envFile);
  }
  return loadXmppConfig(process.env);
}

function websocketUrl(apiUrl: string): string {
  const url = new URL(apiUrl);
  return `${url.protocol === 'https:' ? 'wss:' : 'ws:'}//${url.host}/ws`;
}

function wavBytes(seconds = 1): Buffer {
  const samples = SAMPLE_RATE * seconds;
  const data = Buffer.alloc(samples * 2);
  for (let index = 0; index < samples; index += 1) {
    const value = Math.round(Math.sin((index / SAMPLE_RATE) * 2 * Math.PI * 440) * 12000);
    data.writeInt16LE(value, index * 2);
  }
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + data.length, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(SAMPLE_RATE, 24);
  header.writeUInt32LE(SAMPLE_RATE * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36);
  header.writeUInt32LE(data.length, 40);
  return Buffer.concat([header, data]);
}

describe.skipIf(!enabled)('voice integration (real ffmpeg + real upload service)', () => {
  let dir: string;
  let engine: VoiceEngine;
  let cleanup: (() => Promise<void>) | undefined;

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'zilar-voice-int-'));
    engine = createFfmpegEngine();
  });

  afterAll(async () => {
    await cleanup?.();
    await rm(dir, { recursive: true, force: true });
  });

  it('converts a recording and round-trips it through XEP-0363', async () => {
    const config = loadConfig();
    const admin = createEjabberdAdminClient(config);
    const local = `voice-${Date.now().toString(36)}`;
    const jid = `${local}@${config.domain}`;
    await admin.registerUser(local);

    const { createXmppCore } = await loadXmppCore();
    const core = createXmppCore({
      service: websocketUrl(config.apiUrl),
      domain: config.domain,
      getToken: async () => {
        const { token } = await issueXmppToken(config, jid);
        return { jid, token };
      },
    });
    cleanup = async () => {
      await core.disconnect().catch(() => {});
    };

    await core.connect();
    expect(core.status()).toBe('online');

    const input = join(dir, 'input.wav');
    const output = join(dir, 'output.m4a');
    await writeFile(input, wavBytes());

    const before = await engine.probe(input);
    await engine.convert(input, output);
    const after = await engine.probe(output);
    const converted = await readFile(output);

    console.log(
      `PASS  converted ${before.durationMs}ms -> ${after.durationMs}ms, ${converted.byteLength} bytes`,
    );

    const slot = await core.requestUploadSlot({
      filename: 'voice.m4a',
      size: converted.byteLength,
      contentType: 'audio/mp4',
    });
    console.log('PASS  upload slot issued by the upload service');

    const put = await fetch(slot.putUrl, {
      method: 'PUT',
      headers: { 'content-type': 'audio/mp4', ...slot.headers },
      body: converted,
    });
    expect(put.status).toBeGreaterThanOrEqual(200);
    expect(put.status).toBeLessThan(300);

    const response = await fetch(slot.getUrl);
    expect(response.status).toBe(200);
    const downloaded = Buffer.from(await response.arrayBuffer());
    expect(downloaded.byteLength).toBe(converted.byteLength);
    expect(downloaded.equals(converted)).toBe(true);
    console.log(`PASS  downloaded ${downloaded.byteLength} bytes from the upload service`);

    await core.disconnect();
  });
});
