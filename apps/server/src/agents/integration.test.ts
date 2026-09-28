/// <reference types="node" />
import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { createXmppCore, type ChatMessage } from '@galena/xmpp-core';
import { DEFAULT_LITELLM_BASE_URL, createLitellmAdminClient } from '../ai/litellm-client';
import type { FetchLike } from '../ai/litellm-client';
import { createKeyCipher } from '../connections/crypto';
import { createDb } from '../db/client';
import { createAgentGateway } from './gateway';
import { PROVIDER_KEY_REJECTED_REPLY } from './reply';
import { createEjabberdAdminClient } from '../xmpp/admin-client';
import type { XmppConfig } from '../xmpp/config';
import { localpartFor } from '../xmpp/provisioning';
import { issueXmppToken } from '../xmpp/token';

/**
 * The gated live check for the agent gateway (T-0034). Against the real
 * ejabberd, LiteLLM and Postgres — the way T-0033's integration test does it:
 * your own branch server on another port, a made-up provider key, no
 * container restarts, and everything cleaned up.
 *
 * 1. Create a user and a connection with a made-up OpenAI key, then an AI.
 * 2. Start the gateway in-process.
 * 3. As the owner (an xmpp-core client with the owner's token), send the AI
 *    a DM: "hello".
 * 4. Expect the AI's reply to be exactly the "provider rejected the API key"
 *    text. With a fake key, that proves the whole path: XMPP in, context,
 *    LiteLLM routing to OpenAI with the owner's key, the error mapped, XMPP
 *    out.
 * 5. Delete everything: the AI, the connection (the AI delete removes its
 *    model and key), and stop the gateway.
 *
 * Required env vars:
 *   GALENA_AGENT_INTEGRATION=1                  (turns the test on)
 *   GALENA_AIS_INTEGRATION_URL=<branch server>  (e.g. http://127.0.0.1:3199)
 *   GALENA_AIS_INTEGRATION_LOG=<file>           (server log, to read the OTP)
 *   GALENA_AIS_INVITE_CODE=<invite>             (a fresh, unused invite code)
 *   GALENA_AIS_TEST_EMAIL=<email>               (a brand-new test email)
 *   EJABBERD_API_URL=<url>                      (e.g. http://127.0.0.1:5280/api)
 *   EJABBERD_ADMIN_JID=<jid>                    (e.g. admin@galena.localhost)
 *   EJABBERD_ADMIN_PASSWORD=<password>
 *   LITELLM_MASTER_KEY=<key>                    (LiteLLM admin key)
 *   DATABASE_URL=<the same Postgres the server runs against>
 *   GALENA_KEY_ENCRYPTION_KEY=<the same key cipher the server runs with>
 *   GALENA_XMPP_JWT_SECRET=<the same JWT secret the server signs with>
 *
 * Optional:
 *   XMPP_DOMAIN       (default galena.localhost)
 *   XMPP_WS_URL       (default ws://127.0.0.1:5280/ws)
 *   LITELLM_BASE_URL  (default http://127.0.0.1:4000)
 *
 * A failure part way best-effort deletes whatever it created.
 */

const ENABLED = process.env['GALENA_AGENT_INTEGRATION'] === '1';

const FAKE_PROVIDER_KEY = 'sk-fake-agent-key-000000000000';
const OTP_TIMEOUT_MS = 20_000;
const POLL_INTERVAL_MS = 300;
const REPLY_TIMEOUT_MS = 150_000;

interface HttpResponse {
  status: number;
  headers: http.IncomingHttpHeaders;
  body: unknown;
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === '') {
    throw new Error(`Set ${name} to run the agent gateway integration test`);
  }
  return value;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function request(
  baseUrl: string,
  path: string,
  options: { method: string; headers: Record<string, string>; body?: unknown },
): Promise<HttpResponse> {
  const url = new URL(`${baseUrl}${path}`);
  const payload = options.body === undefined ? undefined : JSON.stringify(options.body);
  const headers: Record<string, string> = {
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

async function fileSize(path: string): Promise<number> {
  try {
    return (await stat(path)).size;
  } catch {
    return 0;
  }
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

function bearer(token: string): Record<string, string> {
  return { authorization: `Bearer ${token}` };
}

function bareJid(jid: string): string {
  const slash = jid.indexOf('/');
  return (slash < 0 ? jid : jid.slice(0, slash)).toLowerCase();
}

async function waitForReply(
  messages: ChatMessage[],
  aiJid: string,
  timeoutMs: number,
): Promise<ChatMessage> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const reply = messages.find(
      (message) => bareJid(message.fromJid) === aiJid && (message.body ?? '') !== '',
    );
    if (reply !== undefined) {
      return reply;
    }
    if (Date.now() > deadline) {
      throw new Error('timed out waiting for the AI reply in the DM');
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }
}

describe.skipIf(!ENABLED)('agent gateway integration (real XMPP + LiteLLM)', () => {
  it(
    'owner DM in, provider-key rejection out',
    { timeout: REPLY_TIMEOUT_MS + 60_000 },
    async () => {
      const baseUrl = requireEnv('GALENA_AIS_INTEGRATION_URL');
      const logPath = requireEnv('GALENA_AIS_INTEGRATION_LOG');
      const invite = requireEnv('GALENA_AIS_INVITE_CODE');
      const email = requireEnv('GALENA_AIS_TEST_EMAIL');
      const domain = process.env['XMPP_DOMAIN'] ?? 'galena.localhost';
      const wsUrl = process.env['XMPP_WS_URL'] ?? 'ws://127.0.0.1:5280/ws';
      const litellmBaseUrl = (process.env['LITELLM_BASE_URL'] ?? DEFAULT_LITELLM_BASE_URL).replace(
        /\/+$/,
        '',
      );
      const masterKey = requireEnv('LITELLM_MASTER_KEY');
      const xmppConfig: XmppConfig = {
        apiUrl: requireEnv('EJABBERD_API_URL').replace(/\/+$/, ''),
        adminJid: requireEnv('EJABBERD_ADMIN_JID'),
        adminPassword: requireEnv('EJABBERD_ADMIN_PASSWORD'),
        domain,
        mucDomain: process.env['XMPP_MUC_DOMAIN'] ?? `rooms.${domain}`,
        wsPublicUrl: wsUrl,
        jwtSecret: requireEnv('GALENA_XMPP_JWT_SECRET'),
      };

      let token: string | undefined;
      let connectionId: string | undefined;
      let aiId: string | undefined;
      let aiJid: string | undefined;
      const directDb = createDb(requireEnv('DATABASE_URL'));
      // The fake key can't produce a real tool call, so this only observes the
      // request shape (tool names, never payloads) while the real request
      // still goes out to LiteLLM untouched.
      const toolNamesSeen: string[] = [];
      const observingFetch: FetchLike = async (url, init) => {
        try {
          const payload = JSON.parse(String(init.body)) as {
            tools?: Array<{ function?: { name?: string } }>;
          };
          for (const tool of payload.tools ?? []) {
            if (typeof tool?.function?.name === 'string') {
              toolNamesSeen.push(tool.function.name);
            }
          }
        } catch {
          // Not a chat payload; the real request still goes out below.
        }
        return fetch(url, init);
      };
      const gateway = createAgentGateway(
        {
          db: directDb.db,
          xmpp: xmppConfig,
          adminClient: createEjabberdAdminClient(xmppConfig),
          litellm: createLitellmAdminClient({ baseUrl: litellmBaseUrl, masterKey }),
          cipher: createKeyCipher(requireEnv('GALENA_KEY_ENCRYPTION_KEY')),
          logger: { info: () => undefined, warn: () => undefined },
          litellmBaseUrl,
          masterKeyForRedaction: masterKey,
          fetchImpl: observingFetch,
        },
        { enabled: true },
      );
      const received: ChatMessage[] = [];

      try {
        // 1. Sign up through the invite, reading the OTP from the server log.
        const before = await fileSize(logPath);
        const sendResponse = await request(baseUrl, '/api/auth/email-otp/send-verification-otp', {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-galena-invite': invite },
          body: { email, type: 'sign-in' },
        });
        expect(sendResponse.status).toBe(200);

        const otp = await readOtpFromLog(logPath, email, before);
        expect(otp).toBeDefined();
        if (otp === undefined) return;

        const signInResponse = await request(baseUrl, '/api/auth/sign-in/email-otp', {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-galena-invite': invite },
          body: { email, otp },
        });
        expect(signInResponse.status).toBe(200);
        const sessionToken = signInResponse.headers['set-auth-token'];
        expect(typeof sessionToken).toBe('string');
        if (typeof sessionToken !== 'string') return;
        token = sessionToken;
        const userId = (signInResponse.body as { user: { id: string } }).user.id;
        const ownerJid = `${localpartFor(userId)}@${domain}`;

        // 2. A connection whose key is made up, then an AI on it.
        const connectionResponse = await request(baseUrl, '/api/connections', {
          method: 'POST',
          headers: { ...bearer(token), 'content-type': 'application/json' },
          body: { provider: 'openai', key: FAKE_PROVIDER_KEY, label: 'Agent integration' },
        });
        expect(connectionResponse.status).toBe(201);
        connectionId = (connectionResponse.body as { id: string }).id;

        const createResponse = await request(baseUrl, '/api/ais', {
          method: 'POST',
          headers: { ...bearer(token), 'content-type': 'application/json' },
          body: {
            name: 'Agent Integration AI',
            template: 'dev',
            providerConnectionId: connectionId,
            model: 'gpt-4o-mini',
            limits: { perDayUsd: 1, perMonthUsd: 3 },
          },
        });
        expect(createResponse.status).toBe(201);
        const created = createResponse.body as { id: string; jid: string };
        aiId = created.id;
        aiJid = created.jid;
        expect(JSON.stringify(createResponse.body)).not.toContain('sk-');

        // 3. Start the gateway in-process: it logs the AI in over XMPP.
        await gateway.start();
        expect(gateway.aiIds()).toContain(aiId);

        // 4. As the owner, send the AI a DM.
        const ownerToken = async () => {
          const issued = await issueXmppToken(xmppConfig, ownerJid);
          return { jid: ownerJid, token: issued.token };
        };
        const owned = createXmppCore({ service: wsUrl, domain, getToken: ownerToken });
        owned.on('message', (message) => {
          received.push(message);
        });
        await owned.connect();
        try {
          await owned.sendMessage(aiJid, 'chat', 'hello');

          // 5. The AI's reply is exactly the provider-key rejection text:
          //    the fake key proves XMPP in → context → LiteLLM routing with
          //    the owner's key → mapped error → XMPP out.
          const reply = await waitForReply(received, aiJid.toLowerCase(), REPLY_TIMEOUT_MS);
          expect(reply.body).toBe(PROVIDER_KEY_REJECTED_REPLY);
          expect(JSON.stringify(reply)).not.toContain('sk-');
          // The turn offered exactly the two persona tools with auto choice.
          expect(toolNamesSeen).toContain('update_persona');
          expect(toolNamesSeen).toContain('revert_persona');
        } finally {
          await owned.disconnect().catch(() => undefined);
        }

        // 6. Delete the AI (removes its model and key) and the connection.
        const deleteResponse = await request(baseUrl, `/api/ais/${aiId}`, {
          method: 'DELETE',
          headers: bearer(token),
        });
        expect(deleteResponse.status).toBe(204);
        aiId = undefined;
        const removeConnection = await request(baseUrl, `/api/connections/${connectionId}`, {
          method: 'DELETE',
          headers: bearer(token),
        });
        expect(removeConnection.status).toBe(204);
        connectionId = undefined;
      } finally {
        // Best-effort cleanup so a failed run leaves nothing behind.
        await gateway.stop().catch(() => undefined);
        if (token !== undefined) {
          const headers = bearer(token);
          if (aiId !== undefined) {
            await request(baseUrl, `/api/ais/${aiId}`, { method: 'DELETE', headers }).catch(
              () => undefined,
            );
          }
          if (connectionId !== undefined) {
            await request(baseUrl, `/api/connections/${connectionId}`, {
              method: 'DELETE',
              headers,
            }).catch(() => undefined);
          }
        }
        await directDb.close();
      }
    },
  );
});
