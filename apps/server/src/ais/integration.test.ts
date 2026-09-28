/// <reference types="node" />
import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { createLitellmAdminClient, DEFAULT_LITELLM_BASE_URL } from '../ai/litellm-client';
import { createEjabberdAdminClient } from '../xmpp/admin-client';
import type { XmppConfig } from '../xmpp/config';
import { localpartFor } from '../xmpp/provisioning';
import { aiLocalpart, virtualKeyAlias } from './service';

/**
 * The gated live check for the server-side AI path. It drives the real dev
 * server (no mocks) through sign-up, then create → check XMPP account and
 * roster → check the LiteLLM cap → patch the cap → delete, and finally checks
 * that the XMPP account and the virtual key are gone. The provider key is
 * made up, so no real model call is made. A run that fails part way best-effort
 * deletes whatever it created, so it never leaves an AI or a connection behind.
 *
 * Required env vars:
 *   GALENA_AIS_INTEGRATION=1                 (turns the test on)
 *   GALENA_AIS_INTEGRATION_LOG=<file>        (server log, to read the OTP)
 *   GALENA_AIS_INVITE_CODE=<invite>          (a fresh, unused invite code)
 *   GALENA_AIS_TEST_EMAIL=<email>            (a brand-new test email)
 *   EJABBERD_API_URL=<url>                   (ejabberd admin API, e.g. http://127.0.0.1:5280/api)
 *   EJABBERD_ADMIN_JID=<jid>                 (e.g. admin@galena.localhost)
 *   EJABBERD_ADMIN_PASSWORD=<password>
 *   LITELLM_MASTER_KEY=<key>                 (LiteLLM admin key)
 *
 * Optional:
 *   GALENA_AIS_INTEGRATION_URL (default http://127.0.0.1:3188)
 *   XMPP_DOMAIN                (default galena.localhost)
 *   LITELLM_BASE_URL           (default http://127.0.0.1:4000)
 *
 *   GALENA_AIS_INTEGRATION=1 \
 *   GALENA_AIS_INTEGRATION_LOG=<server log file> \
 *   GALENA_AIS_INVITE_CODE=<fresh invite> \
 *   GALENA_AIS_TEST_EMAIL=<new test email> \
 *   EJABBERD_API_URL=http://127.0.0.1:5280/api \
 *   EJABBERD_ADMIN_JID=admin@galena.localhost \
 *   EJABBERD_ADMIN_PASSWORD=<password> \
 *   LITELLM_MASTER_KEY=<key> \
 *   pnpm --filter @galena/server test src/ais/integration.test.ts
 *
 * The server's ConsoleMailer writes `[dev-mailer] OTP for <email>: <code>` to
 * its log; the code is read from there, never from the response.
 */

const ENABLED = process.env['GALENA_AIS_INTEGRATION'] === '1';
const MODELS_ENABLED = process.env['GALENA_AI_MODELS_INTEGRATION'] === '1';

const FAKE_PROVIDER_KEY = 'sk-fake-integration-key-000000000000';
const OTP_TIMEOUT_MS = 20_000;
const POLL_INTERVAL_MS = 300;

interface HttpResponse {
  status: number;
  headers: http.IncomingHttpHeaders;
  body: unknown;
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === '') {
    throw new Error(`Set ${name} to run the AIs integration test`);
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

// One record from `/key/list?return_full_object=true`. `key_alias` names the
// AI; `token` (or `token_id`) is the handle `/key/info?key=` accepts. Without
// `return_full_object=true` this LiteLLM returns bare token strings, which
// carry no alias to match on.
interface KeyListEntry {
  token?: string;
  token_id?: string;
  key?: string;
  key_alias?: string | null;
}

function entryToken(entry: KeyListEntry): string | undefined {
  return entry.token ?? entry.token_id ?? entry.key;
}

// Finds the LiteLLM token id for an AI's key alias. `/key/info?key_alias=` is
// not supported by this pinned version, so the key is located through
// `/key/list?return_full_object=true` and then read with `/key/info?key=<token>`.
async function findKeyToken(baseUrl: string, masterKey: string, alias: string): Promise<string> {
  const response = await fetch(`${baseUrl}/key/list?return_full_object=true&size=100`, {
    headers: { authorization: `Bearer ${masterKey}` },
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) {
    throw new Error(`GET /key/list failed with HTTP ${response.status}`);
  }
  const body = (await response.json()) as { keys?: KeyListEntry[] };
  const match = (body.keys ?? []).find((entry) => entry.key_alias === alias);
  const token = match === undefined ? undefined : entryToken(match);
  if (token === undefined) {
    throw new Error(`no LiteLLM key with alias "${alias}"`);
  }
  return token;
}

async function isKeyPresent(baseUrl: string, masterKey: string, alias: string): Promise<boolean> {
  try {
    await findKeyToken(baseUrl, masterKey, alias);
    return true;
  } catch {
    return false;
  }
}

describe.skipIf(!ENABLED)('AIs integration (real server)', () => {
  it('create → cap → patch cap → delete, against real ejabberd and LiteLLM', async () => {
    const baseUrl = process.env['GALENA_AIS_INTEGRATION_URL'] ?? 'http://127.0.0.1:3188';
    const logPath = requireEnv('GALENA_AIS_INTEGRATION_LOG');
    const invite = requireEnv('GALENA_AIS_INVITE_CODE');
    const email = requireEnv('GALENA_AIS_TEST_EMAIL');
    const domain = process.env['XMPP_DOMAIN'] ?? 'galena.localhost';
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
      wsPublicUrl: '',
      jwtSecret: '',
    };
    const adminClient = createEjabberdAdminClient(xmppConfig);
    const litellm = createLitellmAdminClient({ baseUrl: litellmBaseUrl, masterKey });

    // The ids the cleanup below may need. Each is cleared once the test itself
    // has deleted it, so an aborted run only tears down what it created.
    let token: string | undefined;
    let connectionId: string | undefined;
    let aiId: string | undefined;

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

      // 2. Create a connection with a made-up key.
      const connectionResponse = await request(baseUrl, '/api/connections', {
        method: 'POST',
        headers: { ...bearer(token), 'content-type': 'application/json' },
        body: { provider: 'openai', key: FAKE_PROVIDER_KEY, label: 'AIs integration' },
      });
      expect(connectionResponse.status).toBe(201);
      connectionId = (connectionResponse.body as { id: string }).id;

      // 3. Create an AI with a 3 USD monthly cap.
      const createResponse = await request(baseUrl, '/api/ais', {
        method: 'POST',
        headers: { ...bearer(token), 'content-type': 'application/json' },
        body: {
          name: 'Integration AI',
          template: 'dev',
          providerConnectionId: connectionId,
          model: 'gpt-4o-mini',
          limits: { perDayUsd: 1, perMonthUsd: 3 },
        },
      });
      expect(createResponse.status).toBe(201);
      const created = createResponse.body as { id: string; jid: string };
      aiId = created.id;
      expect(created.jid).toBe(`${aiLocalpart(created.id)}@${domain}`);
      expect(JSON.stringify(createResponse.body)).not.toContain('sk-');

      // 4. The XMPP account exists and is in the owner's roster.
      expect(await adminClient.userExists(aiLocalpart(created.id))).toBe(true);
      const roster = await adminClient.getRoster(localpartFor(userId));
      expect(roster).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            jid: created.jid,
            nick: 'Integration AI',
            subscription: 'both',
          }),
        ]),
      );

      // 5. The gateway key is capped at perMonthUsd.
      const alias = virtualKeyAlias(created.id);
      const keyToken = await findKeyToken(litellmBaseUrl, masterKey, alias);
      const info = await litellm.getKeyInfo(keyToken);
      expect(info.maxBudget).toBe(3);

      // 6. Patching the limit updates the cap in the gateway.
      const patchResponse = await request(baseUrl, `/api/ais/${created.id}`, {
        method: 'PATCH',
        headers: { ...bearer(token), 'content-type': 'application/json' },
        body: { limits: { perDayUsd: 1, perMonthUsd: 7 } },
      });
      expect(patchResponse.status).toBe(200);
      const patchedInfo = await litellm.getKeyInfo(keyToken);
      expect(patchedInfo.maxBudget).toBe(7);

      // 7. Delete: the account and the key are gone.
      const deleteResponse = await request(baseUrl, `/api/ais/${created.id}`, {
        method: 'DELETE',
        headers: bearer(token),
      });
      expect(deleteResponse.status).toBe(204);
      aiId = undefined;
      expect(await adminClient.userExists(aiLocalpart(created.id))).toBe(false);
      expect(await isKeyPresent(litellmBaseUrl, masterKey, alias)).toBe(false);

      // 8. Clean up the connection we created.
      const removeConnection = await request(baseUrl, `/api/connections/${connectionId}`, {
        method: 'DELETE',
        headers: bearer(token),
      });
      expect(removeConnection.status).toBe(204);
      connectionId = undefined;
    } finally {
      // Best-effort cleanup so a run that fails part way leaves no AI or
      // connection behind. Cleanup errors are swallowed: they must never mask
      // the original failure.
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
    }
  });
});

// One entry from `GET /model/info`. `model_name` is the public group name;
// `model_id` is the generated id `/model/delete` needs.
interface ModelListEntry {
  model_id?: string;
  model_name?: string;
  model_info?: Record<string, unknown>;
}

async function listModels(baseUrl: string, masterKey: string): Promise<ModelListEntry[]> {
  const response = await request(baseUrl, '/model/info', {
    method: 'GET',
    headers: { authorization: `Bearer ${masterKey}` },
  });
  if (response.status !== 200) {
    throw new Error(`GET /model/info failed with HTTP ${response.status}`);
  }
  const body = response.body as { data?: ModelListEntry[] } | null;
  return body?.data ?? [];
}

/**
 * The gated live check for T-0033's private models. It drives the real dev
 * server (no mocks) through sign-up, then create an AI whose connection holds a
 * made-up provider key, and checks:
 *   1. LiteLLM has a model named `ai-<aiId>`;
 *   2. the AI's virtual key lists only that model;
 *   3. a virtual key allowed to call it reaches the *provider*, which rejects
 *      the made-up key (proving the owner's key was used — T-0007's reasoning);
 *   4. deleting the AI removes both the model and the key.
 * A failure part way best-effort deletes whatever it created.
 *
 * Required env vars (the same as the AIs test, plus):
 *   GALENA_AI_MODELS_INTEGRATION=1
 *   LITELLM_MASTER_KEY=<key>
 *
 * Optional:
 *   GALENA_AIS_INTEGRATION_URL (default http://127.0.0.1:3188)
 *   LITELLM_BASE_URL           (default http://127.0.0.1:4000)
 */
describe.skipIf(!MODELS_ENABLED)('AI models integration (real server + LiteLLM)', () => {
  it('registers a private model, routes it to the owner key, and deletes both', async () => {
    const baseUrl = process.env['GALENA_AIS_INTEGRATION_URL'] ?? 'http://127.0.0.1:3188';
    const logPath = requireEnv('GALENA_AIS_INTEGRATION_LOG');
    const invite = requireEnv('GALENA_AIS_INVITE_CODE');
    const email = requireEnv('GALENA_AIS_TEST_EMAIL');
    const litellmBaseUrl = (process.env['LITELLM_BASE_URL'] ?? DEFAULT_LITELLM_BASE_URL).replace(
      /\/+$/,
      '',
    );
    const masterKey = requireEnv('LITELLM_MASTER_KEY');
    const litellm = createLitellmAdminClient({ baseUrl: litellmBaseUrl, masterKey });

    let token: string | undefined;
    let connectionId: string | undefined;
    let aiId: string | undefined;
    let modelName: string | undefined;
    let probeKey: string | undefined;

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

      // 2. A connection whose key is made up: no real provider call succeeds.
      const connectionResponse = await request(baseUrl, '/api/connections', {
        method: 'POST',
        headers: { ...bearer(token), 'content-type': 'application/json' },
        body: { provider: 'openai', key: FAKE_PROVIDER_KEY, label: 'AI models integration' },
      });
      expect(connectionResponse.status).toBe(201);
      connectionId = (connectionResponse.body as { id: string }).id;

      // 3. Create the AI. The server decrypts the connection key once and
      //    registers a private `ai-<id>` model for it.
      const createResponse = await request(baseUrl, '/api/ais', {
        method: 'POST',
        headers: { ...bearer(token), 'content-type': 'application/json' },
        body: {
          name: 'Models Integration AI',
          template: 'dev',
          providerConnectionId: connectionId,
          model: 'gpt-4o-mini',
          limits: { perDayUsd: 1, perMonthUsd: 3 },
        },
      });
      expect(createResponse.status).toBe(201);
      const created = createResponse.body as { id: string; jid: string };
      aiId = created.id;
      modelName = `ai-${created.id}`;
      expect(JSON.stringify(createResponse.body)).not.toContain('sk-');

      // 4. LiteLLM has the model, and the AI's key lists only that model.
      const models = await listModels(litellmBaseUrl, masterKey);
      expect(models.some((entry) => entry.model_name === modelName)).toBe(true);

      const alias = virtualKeyAlias(created.id);
      const keyToken = await findKeyToken(litellmBaseUrl, masterKey, alias);
      const info = await litellm.getKeyInfo(keyToken);
      expect(info.models).toEqual([modelName]);

      // 5. A virtual key allowed to call the model reaches the provider, which
      //    rejects the owner's made-up key. That is the routing proof.
      const issued = await litellm.generateKey({
        models: [modelName],
        maxBudget: 1,
        budgetDuration: '1d',
        keyAlias: 't0033-models-probe',
      });
      probeKey = issued.key;
      const completion = await request(litellmBaseUrl, '/chat/completions', {
        method: 'POST',
        headers: { authorization: `Bearer ${issued.key}`, 'content-type': 'application/json' },
        body: { model: modelName, messages: [{ role: 'user', content: 'ping' }] },
      });
      expect(completion.status).toBe(401);
      const completionText = JSON.stringify(completion.body).toLowerCase();
      expect(completionText).toMatch(/authentication|incorrect api key|invalid api key/);

      // 6. Delete the AI: the model and the key are both gone.
      const deleteResponse = await request(baseUrl, `/api/ais/${created.id}`, {
        method: 'DELETE',
        headers: bearer(token),
      });
      expect(deleteResponse.status).toBe(204);
      aiId = undefined;
      expect(await isKeyPresent(litellmBaseUrl, masterKey, alias)).toBe(false);
      const afterDelete = await listModels(litellmBaseUrl, masterKey);
      expect(afterDelete.some((entry) => entry.model_name === modelName)).toBe(false);
      modelName = undefined;

      // 7. Clean up the connection we created.
      const removeConnection = await request(baseUrl, `/api/connections/${connectionId}`, {
        method: 'DELETE',
        headers: bearer(token),
      });
      expect(removeConnection.status).toBe(204);
      connectionId = undefined;
    } finally {
      // Best-effort cleanup so a failed run leaves nothing behind: the probe
      // key, then the AI (which removes its model and key), then any orphan
      // model left by a failed server-side delete, then the connection.
      if (probeKey !== undefined) {
        await litellm.revokeKey(probeKey).catch(() => undefined);
      }
      if (token !== undefined) {
        const headers = bearer(token);
        if (aiId !== undefined) {
          await request(baseUrl, `/api/ais/${aiId}`, { method: 'DELETE', headers }).catch(
            () => undefined,
          );
        }
        if (modelName !== undefined) {
          try {
            const remaining = await listModels(litellmBaseUrl, masterKey);
            const orphan = remaining.find((entry) => entry.model_name === modelName);
            if (orphan?.model_id !== undefined) {
              await litellm.deleteModel(orphan.model_id);
            }
          } catch {
            // The model is already gone or LiteLLM is unreachable.
          }
        }
        if (connectionId !== undefined) {
          await request(baseUrl, `/api/connections/${connectionId}`, {
            method: 'DELETE',
            headers,
          }).catch(() => undefined);
        }
      }
    }
  });
});
