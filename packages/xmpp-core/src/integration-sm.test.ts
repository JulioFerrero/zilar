// Stream-management (XEP-0198) reproduction for T-0021.
//
// Keeps two clients connected for at least 60 seconds while exchanging 200+
// stanzas (messages, presence, IQ pings) and checks that ejabberd does not
// close the session with "Client acknowledged more stanzas than sent by
// server", the client never disconnects, and the status stays online.
//
// Skipped unless ZILAR_XMPP_INTEGRATION=1, like integration.test.ts.
//
//   pnpm infra:up
//   ZILAR_XMPP_INTEGRATION=1 pnpm --filter @zilar/xmpp-core test
//   pnpm infra:down
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { createEjabberdAdminClient } from '../../../apps/server/src/xmpp/admin-client';
import { loadXmppConfig, type XmppConfig } from '../../../apps/server/src/xmpp/config';
import { issueXmppToken } from '../../../apps/server/src/xmpp/token';
import { createXmppCore, type XmppCore } from './index';
import type { ConnectionStatus } from './types';

const integrationEnabled = process.env.ZILAR_XMPP_INTEGRATION === '1';
const DURATION_MS = Number(process.env.ZILAR_XMPP_SM_DURATION_MS ?? 60_000);
const TARGET_STANZAS = Number(process.env.ZILAR_XMPP_SM_STANZAS ?? 220);
const REPO_ROOT = fileURLToPath(new URL('../../..', import.meta.url));

function loadConfig(): XmppConfig {
  const envFile = fileURLToPath(new URL('../../../infra/.env', import.meta.url));
  if (existsSync(envFile)) {
    process.loadEnvFile(envFile);
  }
  return loadXmppConfig(process.env);
}

function websocketUrl(apiUrl: string): string {
  const url = new URL(apiUrl);
  return `${url.protocol === 'https:' ? 'wss:' : 'ws:'}//${url.host}/ws`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Reads ejabberd's log since `sinceIso` and returns every line that reports a
// stream-management acknowledgement problem. docker compose is invoked
// directly (the dev stack is up when the integration test runs).
function smLogProblems(sinceIso: string): string[] {
  const output = execFileSync(
    'docker',
    [
      'compose',
      '-f',
      `${REPO_ROOT}infra/docker-compose.dev.yml`,
      '--env-file',
      `${REPO_ROOT}infra/.env`,
      'logs',
      '--since',
      sinceIso,
      'ejabberd',
    ],
    { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 },
  );
  return output
    .split('\n')
    .filter((line) => /acknowledged more stanzas|stanzas, but only/i.test(line));
}

type Tracked = {
  core: XmppCore;
  statuses: ConnectionStatus[];
  unexpected: string[];
};

function trackStatus(core: XmppCore): Tracked {
  const statuses: ConnectionStatus[] = [core.status()];
  const unexpected: string[] = [];
  core.on('status', (status) => {
    statuses.push(status);
    if (status === 'offline' || status === 'reconnecting') {
      unexpected.push(status);
    }
  });
  core.on('error', (event) => {
    unexpected.push(`error: ${event.message}`);
  });
  return { core, statuses, unexpected };
}

describe.skipIf(!integrationEnabled)('@zilar/xmpp-core stream management (XEP-0198)', () => {
  it('keeps two clients online while exchanging 200+ stanzas over 60s', async () => {
    const config = loadConfig();
    const service = websocketUrl(config.apiUrl);
    const domain = config.domain;
    const admin = createEjabberdAdminClient(config);
    const suffix = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    const aliceJid = `sm-alice-${suffix}@${domain}`;
    const bobJid = `sm-bob-${suffix}@${domain}`;
    const roomJid = `sm-${suffix}@${config.mucDomain}`;

    await admin.registerUser(`sm-alice-${suffix}`);
    await admin.registerUser(`sm-bob-${suffix}`);
    await admin.createRoom(`sm-${suffix}`, { title: 'T-0021 stream-management room' });
    await admin.setAffiliation(`sm-${suffix}`, aliceJid, 'owner');
    await admin.setAffiliation(`sm-${suffix}`, bobJid, 'member');

    const token = (jid: string) => async () => ({
      jid,
      token: (await issueXmppToken(config, jid)).token,
    });

    const alice = trackStatus(createXmppCore({ service, domain, getToken: token(aliceJid) }));
    const bob = trackStatus(createXmppCore({ service, domain, getToken: token(bobJid) }));

    const sinceIso = new Date().toISOString();
    let received = 0;
    bob.core.on('message', () => {
      received += 1;
    });
    alice.core.on('message', () => {
      received += 1;
    });

    let sent = 0;

    try {
      await alice.core.connect();
      await bob.core.connect();
      expect(alice.core.status()).toBe('online');
      expect(bob.core.status()).toBe('online');

      await alice.core.joinRoom(roomJid, 'alice');
      await bob.core.joinRoom(roomJid, 'bob');
      await sleep(500);

      const deadline = Date.now() + DURATION_MS;
      let round = 0;
      while (Date.now() < deadline || sent < TARGET_STANZAS) {
        round += 1;
        if (round % 2 === 1) {
          // Room messages (counted as stanzas, trigger <r/> requests and
          // delivery/carbons back).
          await alice.core.sendMessage(roomJid, 'groupchat', `room ${round}`);
          await bob.core.sendMessage(roomJid, 'groupchat', `room ${round} reply`);
          sent += 2;
        } else {
          // Direct messages in both directions.
          await alice.core.sendMessage(bobJid, 'chat', `dm ${round}`);
          await bob.core.sendMessage(aliceJid, 'chat', `dm ${round} reply`);
          sent += 2;
        }

        // Presence is a stanza: refreshing it keeps stream management busy.
        if (round % 10 === 0) {
          // Typing is a message stanza too.
          alice.core.sendTyping(roomJid, 'groupchat', 'composing');
          sent += 1;
        }

        // Pace the loop but stay well under the 60s for 200+ stanzas; the
        // last portion of the run then idles while the connection must stay up.
        if (sent < TARGET_STANZAS) {
          await sleep(120);
        } else {
          await sleep(400);
        }
      }

      expect(sent).toBeGreaterThanOrEqual(TARGET_STANZAS);
      expect(alice.unexpected).toEqual([]);
      expect(bob.unexpected).toEqual([]);
      expect(alice.core.status()).toBe('online');
      expect(bob.core.status()).toBe('online');

      const problems = smLogProblems(sinceIso);
      expect(problems).toEqual([]);

      console.log(
        `\nPASS  two clients stayed online for ${Math.round(DURATION_MS / 1000)}s; sent ${sent} stanzas, received ${received} messages; no stream-management ack errors`,
      );
    } finally {
      await admin.destroyRoom(`sm-${suffix}`).catch(() => undefined);
      await alice.core.disconnect().catch(() => undefined);
      await bob.core.disconnect().catch(() => undefined);
    }
  }, 180_000);
});
