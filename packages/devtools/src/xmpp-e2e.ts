// End-to-end spike for the XMPP chat backbone (plan §23, spike S1).
//
//   pnpm xmpp:e2e
//
// Run against the dev stack (pnpm infra:up). It exercises what the product
// needs from ejabberd: our server creates accounts and rooms through the admin
// API, clients log in with a short-lived JWT, two users talk in a members-only
// MUC room, and the history comes back through MAM. It also checks the ways in
// should not work (expired token, wrong secret, non-member join, user-created
// room). One line per step; a non-zero exit code if any step fails.
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { client, xml, type XmppClient, type XmppElement } from '@xmpp/client';
import { loadXmppConfig, type XmppConfig } from '../../../apps/server/src/xmpp/config';
import { createEjabberdAdminClient } from '../../../apps/server/src/xmpp/admin-client';
import { issueXmppToken } from '../../../apps/server/src/xmpp/token';

const MUC_NAMESPACE = 'http://jabber.org/protocol/muc';
const MAM_NAMESPACE = 'urn:xmpp:mam:2';
const FORWARD_NAMESPACE = 'urn:xmpp:forward:0';
const DELAY_NAMESPACE = 'urn:xmpp:delay';
const DATA_FORMS_NAMESPACE = 'jabber:x:data';
const STEP_TIMEOUT_MS = 10_000;

const repoRoot = fileURLToPath(new URL('../../../', import.meta.url));
const envFile = join(repoRoot, 'infra', '.env');

type Runtime = {
  domain: string;
  websocketUrl: string;
};

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function loadEnvironment(): XmppConfig {
  if (!existsSync(envFile)) {
    throw new Error(
      `missing ${envFile}. Copy infra/.env.example to infra/.env and fill it in, then run pnpm infra:up`,
    );
  }
  process.loadEnvFile(envFile);
  return loadXmppConfig(process.env);
}

// The admin API URL ends in /api; the XMPP WebSocket lives next to it on /ws.
function websocketUrlFromApiUrl(apiUrl: string): string {
  const url = new URL(apiUrl);
  const protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${url.host}/ws`;
}

function xmppErrorCondition(stanza: XmppElement): string {
  const condition = stanza.getChild('error')?.getChildElements()[0];
  return condition === undefined ? 'unknown error' : condition.getName();
}

function connect(
  runtime: Runtime,
  localpart: string,
  password: string,
  resource: string,
): Promise<XmppClient> {
  const xmpp = client({
    service: runtime.websocketUrl,
    domain: runtime.domain,
    username: localpart,
    password,
    resource,
  });

  return new Promise((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      void xmpp.stop().catch(() => {});
      reject(new Error(`timed out logging in as ${localpart}`));
    }, STEP_TIMEOUT_MS);

    // This listener stays attached for the life of the client; after the
    // promise settles it only prevents an unhandled 'error' event.
    xmpp.on('error', (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      void xmpp.stop().catch(() => {});
      reject(new Error(`login failed for ${localpart}: ${error.message}`));
    });

    xmpp.on('online', () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(xmpp);
    });

    xmpp.start().catch((error: unknown) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(new Error(`could not start the stream for ${localpart}: ${errorMessage(error)}`));
    });
  });
}

// Resolves with the rejection reason when the login fails, as expected.
async function expectLoginFails(
  runtime: Runtime,
  localpart: string,
  password: string,
  label: string,
): Promise<string> {
  try {
    const xmpp = await connect(runtime, localpart, password, 'negative');
    await xmpp.stop().catch(() => {});
  } catch (error) {
    return errorMessage(error);
  }
  throw new Error(`${label}: the login unexpectedly succeeded`);
}

function waitForPresence(
  xmpp: XmppClient,
  roomJid: string,
  expected: 'available' | 'error',
  description: string,
): Promise<XmppElement> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(new Error(`timed out waiting for ${description}`));
    }, STEP_TIMEOUT_MS);

    xmpp.on('stanza', (stanza: XmppElement) => {
      if (settled || !stanza.is('presence')) return;
      if (!(stanza.attrs['from'] ?? '').startsWith(`${roomJid}/`)) return;
      const type = stanza.attrs['type'];
      if (type === 'error') {
        settled = true;
        clearTimeout(timer);
        if (expected === 'error') {
          resolve(stanza);
        } else {
          reject(new Error(`the room rejected the join: ${xmppErrorCondition(stanza)}`));
        }
        return;
      }
      if (type === undefined && expected === 'available') {
        settled = true;
        clearTimeout(timer);
        resolve(stanza);
      }
    });
  });
}

// When expected is "error", resolves with the error condition ejabberd sent.
async function joinRoom(
  xmpp: XmppClient,
  roomJid: string,
  nick: string,
  expected: 'available' | 'error',
): Promise<string | undefined> {
  const presence = waitForPresence(xmpp, roomJid, expected, `join of ${roomJid}`);
  await xmpp.send(
    xml('presence', { to: `${roomJid}/${nick}` }, xml('x', { xmlns: MUC_NAMESPACE })),
  );
  const stanza = await presence;
  return expected === 'error' ? xmppErrorCondition(stanza) : undefined;
}

function collectGroupchat(xmpp: XmppClient, roomJid: string, into: string[]): void {
  xmpp.on('stanza', (stanza: XmppElement) => {
    if (!stanza.is('message') || stanza.attrs['type'] !== 'groupchat') return;
    if (!(stanza.attrs['from'] ?? '').startsWith(`${roomJid}/`)) return;
    const body = stanza.getChildText('body');
    if (body !== null && body !== '') {
      into.push(body);
    }
  });
}

async function sendGroupchat(
  xmpp: XmppClient,
  roomJid: string,
  id: string,
  body: string,
): Promise<void> {
  await xmpp.send(xml('message', { type: 'groupchat', to: roomJid, id }, xml('body', {}, body)));
}

async function waitUntil(predicate: () => boolean, description: string): Promise<void> {
  const deadline = Date.now() + STEP_TIMEOUT_MS;
  while (!predicate()) {
    if (Date.now() > deadline) {
      throw new Error(`timed out waiting for ${description}`);
    }
    await sleep(50);
  }
}

type MamMessage = { body: string; timestamp: string };

function queryRoomMam(xmpp: XmppClient, roomJid: string, queryId: string): Promise<MamMessage[]> {
  const iqId = `mam-${queryId}`;
  const messages: MamMessage[] = [];

  return new Promise((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(new Error(`timed out waiting for the MAM result of ${roomJid}`));
    }, STEP_TIMEOUT_MS);

    xmpp.on('stanza', (stanza: XmppElement) => {
      if (settled) return;
      if (stanza.is('message')) {
        const result = stanza.getChild('result', MAM_NAMESPACE);
        if (result === undefined || result.attrs['queryid'] !== queryId) return;
        const forwarded = result.getChild('forwarded', FORWARD_NAMESPACE);
        const body = forwarded?.getChild('message')?.getChildText('body') ?? '';
        const timestamp = forwarded?.getChild('delay', DELAY_NAMESPACE)?.attrs['stamp'] ?? '';
        if (body !== '') {
          messages.push({ body, timestamp });
        }
        return;
      }
      if (stanza.is('iq') && stanza.attrs['id'] === iqId) {
        settled = true;
        clearTimeout(timer);
        if (stanza.attrs['type'] === 'error') {
          reject(new Error(`MAM query to ${roomJid} failed: ${xmppErrorCondition(stanza)}`));
        } else {
          resolve(messages);
        }
      }
    });

    xmpp
      .send(
        xml(
          'iq',
          { type: 'set', id: iqId, to: roomJid },
          xml(
            'query',
            { xmlns: MAM_NAMESPACE, queryid: queryId },
            xml(
              'x',
              { xmlns: DATA_FORMS_NAMESPACE, type: 'submit' },
              xml('field', { var: 'FORM_TYPE', type: 'hidden' }, xml('value', {}, MAM_NAMESPACE)),
            ),
          ),
        ),
      )
      .catch((error: unknown) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(new Error(`could not send the MAM query: ${errorMessage(error)}`));
      });
  });
}

async function main(): Promise<void> {
  const config = loadEnvironment();
  const runtime: Runtime = {
    domain: config.domain,
    websocketUrl: websocketUrlFromApiUrl(config.apiUrl),
  };
  const admin = createEjabberdAdminClient(config);

  const suffix = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const aliceLocal = `e2e-alice-${suffix}`;
  const bobLocal = `e2e-bob-${suffix}`;
  const carolLocal = `e2e-carol-${suffix}`;
  const roomId = `e2e-${suffix}`;
  const roomJid = `${roomId}@${config.mucDomain}`;
  const aliceJid = `${aliceLocal}@${config.domain}`;
  const bobJid = `${bobLocal}@${config.domain}`;
  const carolJid = `${carolLocal}@${config.domain}`;

  const messages = [
    `hello from Alice (1) [${suffix}]`,
    `hello from Alice (2) [${suffix}]`,
    `hello from Alice (3) [${suffix}]`,
  ];

  let alice: XmppClient | undefined;
  let bob: XmppClient | undefined;
  let carol: XmppClient | undefined;

  let failed = 0;
  async function step(name: string, run: () => Promise<void>): Promise<void> {
    try {
      await run();
      console.log(`PASS  ${name}`);
    } catch (error) {
      failed += 1;
      console.error(`FAIL  ${name}`);
      console.error(`      ${errorMessage(error)}`);
    }
  }

  function requireAlice(): XmppClient {
    if (alice === undefined) throw new Error('Alice is not connected');
    return alice;
  }

  function requireBob(): XmppClient {
    if (bob === undefined) throw new Error('Bob is not connected');
    return bob;
  }

  console.log(`XMPP end-to-end spike: room ${roomJid}\n`);

  await step('our server registers the e2e users through the admin API', async () => {
    for (const localpart of [aliceLocal, bobLocal, carolLocal]) {
      const { created } = await admin.registerUser(localpart);
      if (!created) throw new Error(`${localpart} already existed`);
      if (!(await admin.userExists(localpart))) throw new Error(`${localpart} is missing`);
    }
  });

  await step(
    'our server creates the members-only room and sets Alice owner, Bob member',
    async () => {
      const { created } = await admin.createRoom(roomId, { title: 'E2E spike room' });
      if (!created) throw new Error(`room ${roomId} already existed`);
      await admin.setAffiliation(roomId, aliceJid, 'owner');
      await admin.setAffiliation(roomId, bobJid, 'member');
      const affiliations = await admin.getAffiliations(roomId);
      const aliceAffiliation = affiliations.find((entry) => entry.jid === aliceJid)?.affiliation;
      const bobAffiliation = affiliations.find((entry) => entry.jid === bobJid)?.affiliation;
      if (aliceAffiliation !== 'owner' || bobAffiliation !== 'member') {
        throw new Error(`unexpected affiliations: ${JSON.stringify(affiliations)}`);
      }
    },
  );

  await step('our server issues a JWT and Alice and Bob log in with it', async () => {
    const aliceToken = await issueXmppToken(config, aliceJid);
    const bobToken = await issueXmppToken(config, bobJid);
    alice = await connect(runtime, aliceLocal, aliceToken.token, 'alice');
    bob = await connect(runtime, bobLocal, bobToken.token, 'bob');
  });

  await step('Alice and Bob join the room', async () => {
    await joinRoom(requireAlice(), roomJid, 'alice', 'available');
    await joinRoom(requireBob(), roomJid, 'bob', 'available');
  });

  await step("Bob receives all three of Alice's messages live", async () => {
    const received: string[] = [];
    collectGroupchat(requireBob(), roomJid, received);
    for (let index = 0; index < messages.length; index += 1) {
      await sendGroupchat(requireAlice(), roomJid, `${suffix}-m${index}`, messages[index]!);
    }
    await waitUntil(
      () => received.length >= messages.length,
      `Bob to receive ${messages.length} messages`,
    );
    if (received.slice(0, messages.length).join('|') !== messages.join('|')) {
      throw new Error(`Bob received ${JSON.stringify(received)}`);
    }
  });

  await step('Bob reconnects with a new token and reads the history back through MAM', async () => {
    await requireBob().stop();
    bob = undefined;
    const freshToken = await issueXmppToken(config, bobJid);
    bob = await connect(runtime, bobLocal, freshToken.token, 'bob-2');
    await joinRoom(requireBob(), roomJid, 'bob', 'available');
    const history = await queryRoomMam(requireBob(), roomJid, `q-${suffix}`);
    const bodies = history.map((entry) => entry.body).filter((body) => messages.includes(body));
    if (bodies.join('|') !== messages.join('|')) {
      throw new Error(`MAM returned ${JSON.stringify(history)}`);
    }
  });

  await step('negative: an expired token is rejected', async () => {
    const { token } = await issueXmppToken(config, aliceJid, 1);
    await sleep(2500);
    const reason = await expectLoginFails(runtime, aliceLocal, token, 'expired token');
    console.log(`      ejabberd answered: ${reason}`);
  });

  await step('negative: a token signed with the wrong secret is rejected', async () => {
    const wrongConfig: XmppConfig = { ...config, jwtSecret: `wrong-${'x'.repeat(40)}` };
    const { token } = await issueXmppToken(wrongConfig, aliceJid);
    const reason = await expectLoginFails(runtime, aliceLocal, token, 'wrong-secret token');
    console.log(`      ejabberd answered: ${reason}`);
  });

  await step(
    'negative: Carol, who is not a member, cannot join the members-only room',
    async () => {
      const carolToken = await issueXmppToken(config, carolJid);
      carol = await connect(runtime, carolLocal, carolToken.token, 'carol');
      const condition = await joinRoom(carol, roomJid, 'carol', 'error');
      console.log(`      the room answered with: ${condition}`);
    },
  );

  await step('negative: a normal user cannot create a room', async () => {
    const nonAdminRoom = `e2e-nonadmin-${suffix}@${config.mucDomain}`;
    const condition = await joinRoom(requireAlice(), nonAdminRoom, 'alice', 'error');
    console.log(`      the MUC service answered with: ${condition}`);
  });

  await step('clean up: the server destroys the room', async () => {
    await admin.destroyRoom(roomId);
  });

  for (const xmpp of [alice, bob, carol]) {
    if (xmpp !== undefined) {
      await xmpp.stop().catch(() => {});
    }
  }

  if (failed > 0) {
    console.error(`\n${failed} step(s) failed. Is the stack up? Try pnpm infra:up.`);
    process.exitCode = 1;
    return;
  }
  console.log('\nAll steps passed.');
}

try {
  await main();
} catch (error) {
  console.error(`FAIL  ${errorMessage(error)}`);
  process.exitCode = 1;
}
