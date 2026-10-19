// T-1603: the status probe against a real unix socket. The server asks the desk
// agent whether it is ready and which image it pinned, and never guesses.

import { createServer } from 'node:net';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { DeskChunk, Hands } from '@zilar/desk';
import type { Logger } from 'pino';
import { loadServerConfig } from '../config/load';
import { createLogger } from '../logger';
import { TEST_SECRET } from '../test-support';
import { createDeskProbe } from '../startup/components';

const DIGEST = `zilar-desk@sha256:${'a'.repeat(64)}`;

const config = loadServerConfig({
  DATABASE_URL: 'postgres://user:hunter2@127.0.0.1:5432/zilar',
  BETTER_AUTH_SECRET: TEST_SECRET,
  EJABBERD_ADMIN_JID: 'admin@zilar.localhost',
  EJABBERD_ADMIN_PASSWORD: 'admin-password',
  ZILAR_XMPP_JWT_SECRET: 'x'.repeat(40),
});

function createFakeHands(): Hands {
  return {
    async provision(spec) {
      return { id: `desk-${spec.key.aiId}`, key: spec.key };
    },
    execute(): AsyncIterable<DeskChunk> {
      return (async function* (): AsyncGenerator<DeskChunk> {
        yield { type: 'exit', code: 0, truncated: false };
      })();
    },
    async stop() {
      return undefined;
    },
    async snapshot(_ref, label) {
      return { deskId: 'desk-1', label, bytes: 0 };
    },
  };
}

interface FakeAgent {
  readonly socketPath: string;
  close: () => Promise<void>;
}

// Answers every request line with one canned reply line (or closes, for null).
async function startAgent(reply: (request: unknown) => string | null): Promise<FakeAgent> {
  const dir = await mkdtemp(join(tmpdir(), 'zilar-desk-probe-'));
  const socketPath = join(dir, 'desk.sock');
  const server = createServer((socket) => {
    socket.on('error', () => undefined);
    let buffer = '';
    socket.on('data', (data) => {
      buffer += String(data);
      let newline = buffer.indexOf('\n');
      while (newline !== -1) {
        const line = buffer.slice(0, newline).trim();
        buffer = buffer.slice(newline + 1);
        if (line.length > 0) {
          const out = reply(JSON.parse(line));
          if (out === null) {
            socket.destroy();
          } else {
            socket.write(`${out}\n`);
            socket.end();
          }
        }
        newline = buffer.indexOf('\n');
      }
    });
  });
  await new Promise<void>((resolve) => server.listen(socketPath, resolve));
  return {
    socketPath,
    close: async () => {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await rm(dir, { recursive: true, force: true });
    },
  };
}

// A real agent always answers with `running` as a list of desk refs and a
// `queued` count (packages/desk/src/agent/lifecycle.ts). The fixtures send that shape
// by default so they exercise the same decode a live agent hits.
function statusReply(status: Record<string, unknown>): string {
  return JSON.stringify({ id: 1, ok: true, status: { running: [], queued: 0, ...status } });
}

const agents: FakeAgent[] = [];

async function agent(reply: (request: unknown) => string | null): Promise<FakeAgent> {
  const started = await startAgent(reply);
  agents.push(started);
  return started;
}

function probeFor(socketPath: string) {
  const logger: Logger = createLogger(config, { write: () => {} });
  return createDeskProbe({ socketPath, hands: createFakeHands(), logger });
}

afterEach(async () => {
  for (const started of agents) {
    await started.close();
  }
  agents.length = 0;
});

describe('createDeskProbe', () => {
  it('returns a client with the pinned digest when the agent is ready', async () => {
    const desk = await agent(() => statusReply({ ready: true, imageDigest: DIGEST }));
    const client = await probeFor(desk.socketPath)();
    expect(client?.imageDigest).toBe(DIGEST);
    expect(client?.hands).toBeDefined();
  });

  it('answers null on a malformed reply', async () => {
    const desk = await agent(() => 'not json');
    await expect(probeFor(desk.socketPath)()).resolves.toBeNull();
  });
});
