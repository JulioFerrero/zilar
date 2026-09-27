// Smoke test for the local dev infrastructure (infra/docker-compose.dev.yml).
//
//   pnpm infra:smoke
//
// It fails with a non-zero exit code and one message per check when the stack
// is not healthy. It talks to the stack the same way a developer would: docker
// compose exec for Postgres and ejabberd, HTTP for the ejabberd admin API and
// LiteLLM, and a real XMPP WebSocket handshake for ejabberd.
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { basicAuthHeader, buildOpenFrame, parseOpenFrame } from './smoke-lib';

const repoRoot = fileURLToPath(new URL('../../../', import.meta.url));
const composeFile = join(repoRoot, 'infra', 'docker-compose.dev.yml');
const envFile = join(repoRoot, 'infra', '.env');

const XMPP_DOMAIN = 'galena.localhost';
const ADMIN_JID = `admin@${XMPP_DOMAIN}`;
const XMPP_WEBSOCKET_URL = 'ws://127.0.0.1:5280/ws';
const EJABBERD_API_URL = 'http://127.0.0.1:5280/api/status';
const LITELLM_LIVELINESS_URL = 'http://127.0.0.1:4000/health/liveliness';
const TIMEOUT_MS = 10_000;

const POSTGRES_USERS = [
  { user: 'galena', database: 'galena' },
  { user: 'ejabberd', database: 'ejabberd' },
  { user: 'litellm', database: 'litellm' },
];

type Check = {
  name: string;
  run: () => void | Promise<void>;
};

const checks: Check[] = [
  {
    name: 'Postgres accepts a connection for the users galena, ejabberd and litellm',
    run: checkPostgres,
  },
  { name: 'ejabberd reports "started" (ejabberdctl status)', run: checkEjabberdStatus },
  { name: 'ejabberd answers /api/status with admin auth', run: checkEjabberdApi },
  { name: 'ejabberd accepts the XMPP WebSocket <open/> handshake', run: checkEjabberdWebSocket },
  { name: 'LiteLLM liveness endpoint answers 200', run: checkLitellm },
];

function compose(args: string[]): string {
  return execFileSync('docker', ['compose', '-f', composeFile, '--env-file', envFile, ...args], {
    encoding: 'utf8',
    timeout: TIMEOUT_MS,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === '') {
    throw new Error(`${name} is not set in ${envFile}`);
  }
  return value;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function loadEnvironment(): void {
  if (!existsSync(envFile)) {
    throw new Error(`missing ${envFile}. Copy infra/.env.example to infra/.env and fill it in`);
  }
  process.loadEnvFile(envFile);
}

function checkPostgres(): void {
  for (const { user, database } of POSTGRES_USERS) {
    try {
      compose(['exec', '-T', 'postgres', 'psql', '-U', user, '-d', database, '-tAc', 'SELECT 1']);
    } catch (error) {
      throw new Error(
        `psql could not connect as "${user}" to "${database}": ${errorMessage(error)}`,
      );
    }
  }
}

function checkEjabberdStatus(): void {
  let output: string;
  try {
    output = compose(['exec', '-T', 'ejabberd', 'ejabberdctl', 'status']);
  } catch (error) {
    throw new Error(`ejabberdctl status failed: ${errorMessage(error)}`);
  }
  if (!output.includes('started')) {
    throw new Error(`unexpected ejabberdctl status output: ${output.trim()}`);
  }
}

async function checkEjabberdApi(): Promise<void> {
  const password = requiredEnv('EJABBERD_ADMIN_PASSWORD');
  const response = await fetch(EJABBERD_API_URL, {
    headers: { authorization: basicAuthHeader(ADMIN_JID, password) },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!response.ok) {
    throw new Error(`${EJABBERD_API_URL} returned HTTP ${response.status} for ${ADMIN_JID}`);
  }
  const body = await response.text();
  if (body.trim() === '') {
    throw new Error(`${EJABBERD_API_URL} returned an empty body`);
  }
}

async function checkEjabberdWebSocket(): Promise<void> {
  const reply = await requestXmppOpen(XMPP_WEBSOCKET_URL, XMPP_DOMAIN, TIMEOUT_MS);
  if (reply.from !== null && reply.from !== XMPP_DOMAIN) {
    throw new Error(`server answered from "${reply.from}", expected "${XMPP_DOMAIN}"`);
  }
}

async function checkLitellm(): Promise<void> {
  const response = await fetch(LITELLM_LIVELINESS_URL, { signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (response.status !== 200) {
    throw new Error(`${LITELLM_LIVELINESS_URL} returned HTTP ${response.status}`);
  }
}

function requestXmppOpen(
  url: string,
  domain: string,
  timeoutMs: number,
): Promise<{ from: string | null }> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url, 'xmpp');
    let settled = false;

    const finish = (action: () => void): void => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      action();
    };

    const timer = setTimeout(() => {
      finish(() => {
        socket.close();
        reject(new Error(`no <open/> reply within ${timeoutMs} ms`));
      });
    }, timeoutMs);

    socket.addEventListener('open', () => {
      socket.send(buildOpenFrame(domain));
    });

    socket.addEventListener('message', (event) => {
      const payload = typeof event.data === 'string' ? event.data : '';
      const reply = parseOpenFrame(payload);
      finish(() => {
        socket.close();
        if (reply === null) {
          reject(new Error(`unexpected reply: ${payload.slice(0, 200)}`));
        } else {
          resolve(reply);
        }
      });
    });

    socket.addEventListener('error', () => {
      finish(() => {
        socket.close();
        reject(new Error(`could not connect to ${url}`));
      });
    });

    socket.addEventListener('close', () => {
      finish(() => {
        reject(new Error(`connection to ${url} closed before an <open/> reply arrived`));
      });
    });
  });
}

async function main(): Promise<void> {
  try {
    loadEnvironment();
  } catch (error) {
    console.error(`FAIL  configuration: ${errorMessage(error)}`);
    process.exitCode = 1;
    return;
  }

  let failed = 0;
  for (const check of checks) {
    try {
      await check.run();
      console.log(`PASS  ${check.name}`);
    } catch (error) {
      failed += 1;
      console.error(`FAIL  ${check.name}`);
      console.error(`      ${errorMessage(error)}`);
    }
  }

  if (failed > 0) {
    console.error(
      `\n${failed} of ${checks.length} checks failed. Is the stack up? Try pnpm infra:up.`,
    );
    process.exitCode = 1;
    return;
  }
  console.log(`\nAll ${checks.length} checks passed.`);
}

await main();
