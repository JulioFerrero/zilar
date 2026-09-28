/// <reference types="node" />
import http from 'node:http';
import { stat, readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

/**
 * The gated live check. It drives the real dev server (no mocks):
 *
 *   GALENA_AUTH_INTEGRATION=1 \
 *   GALENA_AUTH_INTEGRATION_LOG=<server log file> \
 *   GALENA_AUTH_INVITE_CODE=<fresh invite> \
 *   GALENA_AUTH_TEST_EMAIL=<new test email> \
 *   pnpm --filter @galena/mobile test
 *
 * Requests go over `node:http` without browser-only headers, like React Native
 * does, so Better Auth's Fetch-Metadata CSRF check behaves as it does on a phone.
 * The server's ConsoleMailer writes `[dev-mailer] OTP for <email>: <code>` to
 * its log; the test reads the code from there, never from the response.
 */

const ENABLED = process.env['GALENA_AUTH_INTEGRATION'] === '1';

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
    throw new Error(`Set ${name} to run the auth integration test`);
  }
  return value;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
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

async function fileSize(path: string): Promise<number> {
  try {
    return (await stat(path)).size;
  } catch {
    return 0;
  }
}

/** Reads the newest OTP for `email` from the server log, after `from`. */
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

async function sendCode(baseUrl: string, email: string, invite?: string): Promise<HttpResponse> {
  return request(baseUrl, '/api/auth/email-otp/send-verification-otp', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(invite === undefined ? {} : { 'x-galena-invite': invite }),
    },
    body: { email, type: 'sign-in' },
  });
}

async function signIn(
  baseUrl: string,
  email: string,
  otp: string,
  invite?: string,
): Promise<HttpResponse> {
  return request(baseUrl, '/api/auth/sign-in/email-otp', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(invite === undefined ? {} : { 'x-galena-invite': invite }),
    },
    body: { email, otp },
  });
}

function bearer(token: string): Record<string, string> {
  return { authorization: `Bearer ${token}` };
}

describe.skipIf(!ENABLED)('auth integration (real server)', () => {
  it(
    'invite → code → name → sign out → sign in again',
    async () => {
      const baseUrl = process.env['GALENA_AUTH_INTEGRATION_URL'] ?? 'http://127.0.0.1:3188';
      const logPath = requireEnv('GALENA_AUTH_INTEGRATION_LOG');
      const invite = requireEnv('GALENA_AUTH_INVITE_CODE');
      const email = requireEnv('GALENA_AUTH_TEST_EMAIL');
      const steps: string[] = [];

      // 1. Request a code for a brand-new email, with the invite header.
      const before = await fileSize(logPath);
      const sendResponse = await sendCode(baseUrl, email, invite);
      expect(sendResponse.status).toBe(200);
      steps.push(`send-code with invite → ${sendResponse.status}`);

      const otp = await readOtpFromLog(logPath, email, before);
      expect(otp).toBeDefined();
      steps.push(`code read from the server log → ${otp?.slice(0, 2)}***`);

      // 2. Verify it. A new user is created and a bearer token returned.
      const firstSignIn = await signIn(baseUrl, email, otp ?? '', invite);
      expect(firstSignIn.status).toBe(200);
      const token = firstSignIn.headers['set-auth-token'];
      expect(typeof token).toBe('string');
      if (typeof token !== 'string') return;
      steps.push(`sign-in with invite → 200, token ${token.slice(0, 3)}***`);

      // 3. GET /api/me with the bearer token.
      const meResponse = await request(baseUrl, '/api/me', {
        method: 'GET',
        headers: bearer(token),
      });
      expect(meResponse.status).toBe(200);
      expect((meResponse.body as { email?: string }).email).toBe(email);
      steps.push(`GET /api/me → ${meResponse.status}`);

      // 4. PATCH /api/me sets the display name.
      const name = `T0026 ${Date.now()}`;
      const patchResponse = await request(baseUrl, '/api/me', {
        method: 'PATCH',
        headers: { ...bearer(token), 'content-type': 'application/json' },
        body: { name },
      });
      expect(patchResponse.status).toBe(200);
      expect((patchResponse.body as { name?: string }).name).toBe(name);
      steps.push(`PATCH /api/me → ${patchResponse.status}`);

      // 5. Sign out invalidates the session.
      const signOutResponse = await request(baseUrl, '/api/auth/sign-out', {
        method: 'POST',
        headers: { ...bearer(token), 'content-type': 'application/json' },
        body: {},
      });
      expect(signOutResponse.status).toBe(200);
      steps.push(`sign-out → ${signOutResponse.status}`);

      // 6. Sign in again as an existing user, with no invite header.
      const beforeSecond = await fileSize(logPath);
      const secondSend = await sendCode(baseUrl, email);
      expect(secondSend.status).toBe(200);
      const secondOtp = await readOtpFromLog(logPath, email, beforeSecond);
      expect(secondOtp).toBeDefined();

      const secondSignIn = await signIn(baseUrl, email, secondOtp ?? '');
      expect(secondSignIn.status).toBe(200);
      const secondToken = secondSignIn.headers['set-auth-token'];
      expect(typeof secondToken).toBe('string');
      if (typeof secondToken !== 'string') return;
      steps.push('second sign-in without invite → 200');

      const secondMe = await request(baseUrl, '/api/me', {
        method: 'GET',
        headers: bearer(secondToken),
      });
      expect(secondMe.status).toBe(200);
      steps.push(`GET /api/me after second sign-in → ${secondMe.status}`);

      console.log(`[auth integration] ${steps.join(' → ')}`);
    },
    OTP_TIMEOUT_MS * 3,
  );
});
