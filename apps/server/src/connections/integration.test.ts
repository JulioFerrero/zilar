/// <reference types="node" />
import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

/**
 * The gated live check for the human connections path. It drives the real dev
 * server (no mocks) through sign-up, then create → list → test → delete a
 * provider connection with a made-up key. No real provider key is used.
 *
 * Required env vars:
 *   GALENA_CONNECTIONS_INTEGRATION=1            (turns the test on)
 *   GALENA_CONNECTIONS_INTEGRATION_LOG=<file>   (server log, to read the OTP)
 *   GALENA_CONNECTIONS_INVITE_CODE=<invite>     (a fresh, unused invite code)
 *   GALENA_CONNECTIONS_TEST_EMAIL=<email>       (a brand-new test email)
 *
 * Optional: GALENA_CONNECTIONS_INTEGRATION_URL (default http://127.0.0.1:3188).
 *
 *   GALENA_CONNECTIONS_INTEGRATION=1 \
 *   GALENA_CONNECTIONS_INTEGRATION_LOG=<server log file> \
 *   GALENA_CONNECTIONS_INVITE_CODE=<fresh invite> \
 *   GALENA_CONNECTIONS_TEST_EMAIL=<new test email> \
 *   pnpm --filter @galena/server test src/connections/integration.test.ts
 *
 * The server's ConsoleMailer writes `[dev-mailer] OTP for <email>: <code>` to
 * its log; the code is read from there, never from the response.
 */

const ENABLED = process.env['GALENA_CONNECTIONS_INTEGRATION'] === '1';

const FAKE_KEY = 'sk-fake-integration-key-000000000000';
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
    throw new Error(`Set ${name} to run the connections integration test`);
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

describe.skipIf(!ENABLED)('connections integration (real server)', () => {
  it('create → list → test → delete with a made-up key', async () => {
    const baseUrl = process.env['GALENA_CONNECTIONS_INTEGRATION_URL'] ?? 'http://127.0.0.1:3188';
    const logPath = requireEnv('GALENA_CONNECTIONS_INTEGRATION_LOG');
    const invite = requireEnv('GALENA_CONNECTIONS_INVITE_CODE');
    const email = requireEnv('GALENA_CONNECTIONS_TEST_EMAIL');

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
    const token = signInResponse.headers['set-auth-token'];
    expect(typeof token).toBe('string');
    if (typeof token !== 'string') return;

    // 2. Create a connection with a made-up key.
    const createResponse = await request(baseUrl, '/api/connections', {
      method: 'POST',
      headers: { ...bearer(token), 'content-type': 'application/json' },
      body: { provider: 'openai', key: FAKE_KEY, label: 'Integration' },
    });
    expect(createResponse.status).toBe(201);
    const created = createResponse.body as { id?: string };
    expect(typeof created.id).toBe('string');
    expect(JSON.stringify(createResponse.body)).not.toContain(FAKE_KEY);
    if (typeof created.id !== 'string') return;

    // 3. List it — the key is never returned.
    const listResponse = await request(baseUrl, '/api/connections', {
      method: 'GET',
      headers: bearer(token),
    });
    expect(listResponse.status).toBe(200);
    const list = listResponse.body as Array<{ id: string }>;
    expect(list.some((entry) => entry.id === created.id)).toBe(true);
    expect(JSON.stringify(list)).not.toContain(FAKE_KEY);

    // 4. Test it — a made-up key is rejected or unreachable, never a success,
    // and the key never appears in the response.
    const testResponse = await request(baseUrl, `/api/connections/${created.id}/test`, {
      method: 'POST',
      headers: { ...bearer(token), 'content-type': 'application/json' },
      body: {},
    });
    expect(testResponse.status).toBe(200);
    const testBody = testResponse.body as { ok: boolean; message?: string };
    expect(testBody.ok).toBe(false);
    expect(typeof testBody.message).toBe('string');
    expect(JSON.stringify(testResponse.body)).not.toContain(FAKE_KEY);

    // 5. Delete it, then confirm it is gone.
    const deleteResponse = await request(baseUrl, `/api/connections/${created.id}`, {
      method: 'DELETE',
      headers: bearer(token),
    });
    expect(deleteResponse.status).toBe(204);

    const afterList = await request(baseUrl, '/api/connections', {
      method: 'GET',
      headers: bearer(token),
    });
    const after = afterList.body as Array<{ id: string }>;
    expect(after.some((entry) => entry.id === created.id)).toBe(false);
  });
});
