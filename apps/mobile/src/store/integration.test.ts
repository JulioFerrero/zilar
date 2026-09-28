/// <reference types="node" />
import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

import { createXmppCore, type ChatMessage } from '@galena/xmpp-core';

import { createChatApi } from '../lib/chat-api';

/**
 * The gated live check for the mobile stack. It drives the real dev server (no
 * mocks):
 *
 *   GALENA_MOBILE_XMPP=1 \
 *   GALENA_AUTH_INTEGRATION_LOG=<server log file> \
 *   GALENA_AUTH_INVITE_CODE=<fresh invite> \
 *   GALENA_MOBILE_TEST_EMAIL=<new test email> \
 *   pnpm --filter @galena/mobile test integration
 *
 * It signs in through the real server (reading the OTP from the server's own
 * log, never from a response), then uses the production `createChatApi` to load
 * the profile and a fresh `POST /api/xmpp/token`, connects `@galena/xmpp-core`,
 * creates and joins a room, sends a group message and receives the room echo,
 * then reconnects and confirms `getToken` is called again with a fresh token.
 */

const ENABLED = process.env['GALENA_MOBILE_XMPP'] === '1';
const OTP_TIMEOUT_MS = 20_000;
const POLL_INTERVAL_MS = 300;
const WAIT_TIMEOUT_MS = 15_000;

interface HttpResponse {
  status: number;
  headers: http.IncomingHttpHeaders;
  body: unknown;
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === '') {
    throw new Error(`Set ${name} to run the mobile XMPP integration test`);
  }
  return value;
}

function randomForwardedFor(): string {
  return `10.${Math.floor(Math.random() * 254) + 1}.${Math.floor(Math.random() * 254) + 1}.${
    Math.floor(Math.random() * 254) + 1
  }`;
}

function request(
  baseUrl: string,
  path: string,
  options: { method: string; headers: Record<string, string>; body?: unknown },
): Promise<HttpResponse> {
  const url = new URL(`${baseUrl}${path}`);
  const payload = options.body === undefined ? undefined : JSON.stringify(options.body);
  const headers: Record<string, string> = {
    'x-forwarded-for': randomForwardedFor(),
    ...options.headers,
    ...(payload === undefined ? {} : { 'content-length': String(Buffer.byteLength(payload)) }),
  };

  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: url.hostname,
        port: url.port,
        path: `${url.pathname}${url.search}`,
        method: options.method,
        headers,
      },
      (res) => {
        let text = '';
        res.setEncoding('utf8');
        res.on('data', (chunk: string) => {
          text += chunk;
        });
        res.on('end', () => {
          let body: unknown = null;
          try {
            body = text === '' ? null : JSON.parse(text);
          } catch {
            body = text;
          }
          resolve({ status: res.statusCode ?? 0, headers: res.headers, body });
        });
      },
    );
    req.on('error', reject);
    if (payload !== undefined) req.write(payload);
    req.end();
  });
}

// The app's `fetch` on a real device sends no browser-only headers; Node's
// global fetch adds `sec-fetch-mode`, which the server rejects. This adapter
// keeps `createChatApi`'s request logic while speaking `node:http`.
async function nodeFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const url = new URL(typeof input === 'string' ? input : input.toString());
  const headers: Record<string, string> = {};
  new Headers(init?.headers).forEach((value, key) => {
    headers[key] = value;
  });
  const body = typeof init?.body === 'string' ? init.body : undefined;
  const response = await request(url.origin, `${url.pathname}${url.search}`, {
    method: init?.method ?? 'GET',
    headers,
    ...(body === undefined ? {} : { body: JSON.parse(body) as unknown }),
  });
  return new Response(response.body === null ? '' : JSON.stringify(response.body), {
    status: response.status,
    headers: { 'content-type': 'application/json' },
  });
}

async function fileSize(path: string): Promise<number> {
  try {
    return (await stat(path)).size;
  } catch {
    return 0;
  }
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

async function readOtpFromLog(
  logPath: string,
  email: string,
  from: number,
): Promise<string | undefined> {
  const pattern = new RegExp(`\\[dev-mailer\\] OTP for ${escapeRegExp(email)}: (\\d{6})`, 'g');
  const deadline = Date.now() + OTP_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const text = await readFile(logPath, 'utf8').catch(() => '');
    const matches = [...text.slice(from).matchAll(pattern)];
    const last = matches.at(-1);
    if (last?.[1] !== undefined) {
      return last[1];
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }
  return undefined;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitFor(predicate: () => boolean, description: string): Promise<void> {
  const deadline = Date.now() + WAIT_TIMEOUT_MS;
  while (!predicate()) {
    if (Date.now() > deadline) {
      throw new Error(`timed out waiting for ${description}`);
    }
    await sleep(50);
  }
}

describe.skipIf(!ENABLED)('mobile XMPP integration (real server)', () => {
  it('signs in, connects xmpp-core, joins a room, sends and receives, then reconnects', async () => {
    const baseUrl = process.env['GALENA_AUTH_INTEGRATION_URL'] ?? 'http://127.0.0.1:3188';
    const logPath = requireEnv('GALENA_AUTH_INTEGRATION_LOG');
    const invite = requireEnv('GALENA_AUTH_INVITE_CODE');
    const email = requireEnv('GALENA_MOBILE_TEST_EMAIL');
    const steps: string[] = [];

    // 1. Sign in through the real server.
    const before = await fileSize(logPath);
    const sendResponse = await request(baseUrl, '/api/auth/email-otp/send-verification-otp', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-galena-invite': invite },
      body: { email, type: 'sign-in' },
    });
    expect(sendResponse.status).toBe(200);
    const otp = await readOtpFromLog(logPath, email, before);
    expect(otp).toBeDefined();
    const signInResponse = await request(baseUrl, '/api/auth/sign-in/email-otp', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-galena-invite': invite },
      body: { email, otp: otp ?? '' },
    });
    expect(signInResponse.status).toBe(200);
    const sessionToken = signInResponse.headers['set-auth-token'];
    expect(typeof sessionToken).toBe('string');
    if (typeof sessionToken !== 'string') return;
    steps.push('sign-in through the real server → 200');

    // 2. The production mobile API client, over a node:http transport.
    const api = createChatApi(
      () => Promise.resolve(sessionToken),
      nodeFetch as unknown as typeof fetch,
      baseUrl,
    );
    const me = await api.getMe();
    expect(me.jid).toBeTruthy();
    steps.push(`GET /api/me → ${me.jid ?? ''}`);

    // 3. A room to join: creating a group also creates the MUC room. The
    //    creator is its owner, so the client can join it immediately.
    const title = `T-0027 ${Date.now().toString(36)}`;
    const createResponse = await request(baseUrl, '/api/groups', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${sessionToken}` },
      body: { title, memberIds: [] },
    });
    expect(createResponse.status).toBe(201);
    const groupId = (createResponse.body as { id?: string }).id;
    expect(typeof groupId).toBe('string');
    const chats = await api.getChats();
    const room = chats.find((entry) => entry.kind === 'group' && entry.groupId === groupId);
    expect(room).toBeDefined();
    const chatJid = room?.chatJid ?? '';
    expect(chatJid).not.toBe('');
    steps.push(`POST /api/groups → ${createResponse.status}, room ${chatJid}`);

    // 4. Connect xmpp-core the way the store does: pre-fetch one token, serve
    //    the first `getToken` from it (no second network call) and fetch a
    //    fresh one on every later (re)connect.
    const firstToken = await api.getXmppToken();
    let tokenNetworkCalls = 1;
    let servedFirstToken = false;
    const core = createXmppCore({
      service: firstToken.service,
      domain: firstToken.domain,
      getToken: async () => {
        if (!servedFirstToken) {
          servedFirstToken = true;
          return { jid: firstToken.jid, token: firstToken.token };
        }
        tokenNetworkCalls += 1;
        const fresh = await api.getXmppToken();
        return { jid: fresh.jid, token: fresh.token };
      },
    });

    const received: ChatMessage[] = [];
    core.on('message', (message) => {
      if (message.chatJid === chatJid) received.push(message);
    });

    try {
      await core.connect();
      expect(core.status()).toBe('online');
      expect(tokenNetworkCalls).toBe(1);
      steps.push(`xmpp-core online as ${core.me() ?? ''}`);

      await core.joinRoom(chatJid, me.name.trim() || 'me');
      await waitFor(
        () => core.occupants(chatJid).some((occupant) => occupant.realJid === me.jid),
        'our own occupant to appear in the room',
      );
      steps.push('joined the room');

      const body = `hello from T-0027 ${Date.now().toString(36)}`;
      await core.sendMessage(chatJid, 'groupchat', body);
      await waitFor(
        () => received.some((message) => message.body === body),
        'the room to reflect our message back',
      );
      steps.push('sent and received a group message');

      expect(tokenNetworkCalls).toBe(1);
      await core.disconnect();
      await core.connect();
      await sleep(500);
      expect(tokenNetworkCalls).toBe(2);
      steps.push(`reconnect fetched a fresh token (getToken network calls: ${tokenNetworkCalls})`);

      console.log(`[mobile xmpp integration] ${steps.join(' → ')}`);
    } finally {
      await core.disconnect().catch(() => undefined);
    }
  }, 120_000);
});
