// End-to-end spike for the XMPP chat backbone (plan §23, spike S1): `pnpm xmpp:e2e`
// against the dev stack exercises account and room creation through the admin API,
// JWT login, a members-only MUC conversation and MAM history, plus the ways in
// that must fail. One line per step; a non-zero exit when any step fails.
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { connect as netConnect } from 'node:net';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { client, xml, type XmppClient, type XmppElement } from '@xmpp/client';
import { createEjabberdAdminClient } from '../../../apps/server/src/xmpp/admin/client';
import type { EjabberdAdminClient } from '../../../apps/server/src/xmpp/admin/types';
import { loadXmppConfig, type XmppConfig } from '../../../apps/server/src/xmpp/config';
import { issueXmppToken } from '../../../apps/server/src/xmpp/token';
import { sleep } from './lead/processes.js';

// Shared helpers for the XMPP end-to-end spike (plan §23, spike S1): config,
// step deadlines and the small stanza utilities.

const STEP_TIMEOUT_MS = 10_000;

const repoRoot = fileURLToPath(new URL('../../../', import.meta.url));
const envFile = join(repoRoot, 'infra', '.env');

type Runtime = {
  domain: string;
  websocketUrl: string;
};

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
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

type Deadline<T> = {
  promise: Promise<T>;
  settled: () => boolean;
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
};

function withDeadline<T>(timeoutMs: number, onTimeout: () => Error): Deadline<T> {
  let settled = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let resolvePromise!: (value: T) => void;
  let rejectPromise!: (error: unknown) => void;
  const promise = new Promise<T>((resolve, reject) => {
    resolvePromise = resolve;
    rejectPromise = reject;
  });

  const settle = (finish: () => void): void => {
    if (settled) return;
    settled = true;
    if (timer !== undefined) clearTimeout(timer);
    finish();
  };

  timer = setTimeout(() => {
    settle(() => rejectPromise(onTimeout()));
  }, timeoutMs);

  return {
    promise,
    settled: () => settled,
    resolve: (value) => settle(() => resolvePromise(value)),
    reject: (error) => settle(() => rejectPromise(error)),
  };
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

  const deadline = withDeadline<XmppClient>(STEP_TIMEOUT_MS, () => {
    void xmpp.stop().catch(() => {});
    return new Error(`timed out logging in as ${localpart}`);
  });

  // This listener stays attached for the life of the client; after the
  // promise settles it only prevents an unhandled 'error' event.
  xmpp.on('error', (error) => {
    if (deadline.settled()) return;
    void xmpp.stop().catch(() => {});
    deadline.reject(new Error(`login failed for ${localpart}: ${error.message}`));
  });

  xmpp.on('online', () => {
    deadline.resolve(xmpp);
  });

  xmpp.start().catch((error: unknown) => {
    deadline.reject(
      new Error(`could not start the stream for ${localpart}: ${errorMessage(error)}`),
    );
  });

  return deadline.promise;
}

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

const MUC_NAMESPACE = 'http://jabber.org/protocol/muc';

function waitForPresence(
  xmpp: XmppClient,
  roomJid: string,
  expected: 'available' | 'error',
  description: string,
): Promise<XmppElement> {
  const deadline = withDeadline<XmppElement>(
    STEP_TIMEOUT_MS,
    () => new Error(`timed out waiting for ${description}`),
  );

  xmpp.on('stanza', (stanza: XmppElement) => {
    if (deadline.settled() || !stanza.is('presence')) return;
    if (!(stanza.attrs['from'] ?? '').startsWith(`${roomJid}/`)) return;
    const type = stanza.attrs['type'];
    if (type === 'error') {
      if (expected === 'error') {
        deadline.resolve(stanza);
      } else {
        deadline.reject(new Error(`the room rejected the join: ${xmppErrorCondition(stanza)}`));
      }
      return;
    }
    if (type === undefined && expected === 'available') {
      deadline.resolve(stanza);
    }
  });

  return deadline.promise;
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

// A DM and a group post to a *pending* (XEP-0198 hibernated) push-enabled session
// must reach the push component. A bare XEP-0114 client stands in for the server's
// component (the dev stack listens on 127.0.0.1:5347): enable XEP-0357, drop the
// socket below the stream, message it, and assert the publish IQ arrives.

const PUSH_NAMESPACE = 'urn:xmpp:push:0';
const COMPONENT_NAMESPACE = 'jabber:component:accept';
const STREAMS_NAMESPACE = 'http://etherx.jabber.org/streams';

// The dev stack publishes the component listener on 127.0.0.1:5347; an isolated
// worktree stack points us at its own with `PUSH_COMPONENT_HOST` / `_PORT`.
function componentHost(): string {
  return process.env['PUSH_COMPONENT_HOST'] ?? '127.0.0.1';
}

function componentPort(): number {
  return Number(process.env['PUSH_COMPONENT_PORT'] ?? '5347');
}

/** The component secret the dev stack bakes from `infra/.env`. */
function componentSecret(): string {
  return process.env['PUSH_COMPONENT_SECRET'] ?? 'CHANGE_ME_PUSH_COMPONENT_SECRET';
}

type PushProbe = {
  /** Resolves once the server has routed a publish IQ for `node` to us. */
  waitForNode: (node: string) => Promise<void>;
  stop: () => Promise<void>;
};

/** A minimal XEP-0114 component: authenticates as `push.<domain>` and records every
 * `<publish node='…'>` the server routes to it. */
async function startPushProbe(domain: string): Promise<PushProbe> {
  const socket = netConnect({ host: componentHost(), port: componentPort() });
  const componentJid = `push.${domain}`;
  const seen = new Set<string>();
  let buffer = '';
  let opened = false;
  const ready = withDeadline<void>(
    STEP_TIMEOUT_MS,
    () => new Error('push component handshake timed out'),
  );

  socket.setEncoding('utf8');
  socket.on('data', (chunk: Buffer | string) => {
    buffer += chunk;
    if (!opened) {
      const id = /<stream:stream\b[^>]*\bid=['"]([^'"]+)['"]/.exec(buffer)?.[1];
      if (id !== undefined) {
        opened = true;
        buffer = '';
        const hash = createHash('sha1')
          .update(id + componentSecret())
          .digest('hex');
        socket.write(`<handshake>${hash}</handshake>`);
      }
      return;
    }
    if (!ready.settled()) {
      if (/<handshake\b[^>]*\/?>/.test(buffer)) {
        buffer = '';
        ready.resolve();
      }
      return;
    }
    for (const match of buffer.matchAll(/<publish\b[^>]*\bnode=['"]([^'"]+)['"]/g)) {
      seen.add(match[1]!);
    }
  });
  socket.on('error', (error: Error) => ready.reject(error));
  // The stream header must stay open (no `/>`): `xml()` self-closes an element
  // with no children, which the server reads as a closed stream.
  socket.write(
    `<stream:stream xmlns="${COMPONENT_NAMESPACE}" xmlns:stream="${STREAMS_NAMESPACE}" to="${componentJid}">`,
  );
  await ready.promise;

  return {
    waitForNode: (node) => waitUntil(() => seen.has(node), `a publish for node ${node}`),
    stop: () =>
      new Promise<void>((resolve) => {
        socket.end('</stream:stream>');
        socket.once('close', () => resolve());
        // A socket that never closes must not hold the spike: resolve anyway.
        void sleep(0).then(resolve);
      }),
  };
}

/**
 * Waits for XEP-0198 stream management: `online` fires before `<enable/>` is sent, so
 * suspending on it would drop a stream that never had SM and never reach `pending`.
 */
async function waitForStreamManagement(xmpp: XmppClient): Promise<void> {
  const client = xmpp as unknown as { streamManagement?: { enabled?: boolean } };
  await waitUntil(
    () => client.streamManagement?.enabled === true,
    'stream management to be enabled',
  );
}

/** Drops the socket below the stream layer, like the app's `suspend()`. */
function suspendClient(xmpp: XmppClient): void {
  const client = xmpp as unknown as {
    socket?: { end(): void } | null;
    reconnect?: { stop(): void };
  };
  client.reconnect?.stop();
  client.socket?.end();
}

/** Sends XEP-0357 `<enable/>` and resolves on the `result` IQ. */
async function enablePush(xmpp: XmppClient, pushJid: string, node: string): Promise<void> {
  const id = `push-enable-${node}`;
  const answered = withDeadline<void>(STEP_TIMEOUT_MS, () => new Error('push enable timed out'));
  xmpp.on('stanza', (stanza: XmppElement) => {
    if (answered.settled() || !stanza.is('iq') || stanza.attrs['id'] !== id) return;
    if (stanza.attrs['type'] === 'result') {
      answered.resolve();
      return;
    }
    answered.reject(new Error(`push enable answered type=${stanza.attrs['type']}`));
  });
  await xmpp.send(
    xml('iq', { type: 'set', id }, xml('enable', { xmlns: PUSH_NAMESPACE, jid: pushJid, node })),
  );
  await answered.promise;
}

function randomSuffix(): string {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

function nodeFor(localpart: string): string {
  return `node-${localpart}`;
}

interface PushReproDeps {
  config: XmppConfig;
  runtime: Runtime;
  admin: EjabberdAdminClient;
  prefix: string;
}

/** Two throwaway users in each other's rosters (mod_block_strangers drops a bare
 * chat stanza), then A enables push, goes pending, B messages A. */
async function pushPendingDm(deps: PushReproDeps): Promise<string> {
  const { config, runtime, admin } = deps;
  const suffix = `${deps.prefix}${randomSuffix()}`;
  const aliceLocal = `e2e-push-a-${suffix}`;
  const bobLocal = `e2e-push-b-${suffix}`;
  const aliceJid = `${aliceLocal}@${config.domain}`;
  const bobJid = `${bobLocal}@${config.domain}`;
  await admin.registerUser(aliceLocal);
  await admin.registerUser(bobLocal);
  await admin.addRosterItem(aliceLocal, bobJid, { nick: 'bob', groups: ['Friends'], subs: 'both' });
  await admin.addRosterItem(bobLocal, aliceJid, {
    nick: 'alice',
    groups: ['Friends'],
    subs: 'both',
  });

  const probe = await startPushProbe(config.domain);
  let alice: XmppClient | undefined;
  let bob: XmppClient | undefined;
  try {
    alice = await connect(
      runtime,
      aliceLocal,
      (await issueXmppToken(config, aliceJid)).token,
      'alice',
    );
    bob = await connect(runtime, bobLocal, (await issueXmppToken(config, bobJid)).token, 'bob');
    await waitForStreamManagement(alice);
    const node = nodeFor(aliceLocal);
    await enablePush(alice, `push.${config.domain}`, node);
    suspendClient(alice);
    // ejabberd logs "waiting 600 seconds for stream resumption"; give it a
    // moment to move the session to `pending` before the DM.
    await sleep(500);
    await bob.send(xml('message', { type: 'chat', to: aliceJid }, xml('body', {}, `dm-${suffix}`)));
    await probe.waitForNode(node);
    return `the component received the DM publish for node ${node}`;
  } finally {
    await bob?.stop().catch(() => {});
    await alice?.stop().catch(() => {});
    await probe.stop();
    await admin.deleteRosterItem(aliceLocal, bobJid).catch(() => {});
    await admin.deleteRosterItem(bobLocal, aliceJid).catch(() => {});
    await admin.unregisterUser(aliceLocal).catch(() => {});
    await admin.unregisterUser(bobLocal).catch(() => {});
  }
}

/** The same shape for a group: join a room, enable push, go pending, post. */
async function pushPendingGroup(deps: PushReproDeps): Promise<string> {
  const { config, runtime, admin } = deps;
  const suffix = `${deps.prefix}${randomSuffix()}`;
  const aliceLocal = `e2e-push-ga-${suffix}`;
  const bobLocal = `e2e-push-gb-${suffix}`;
  const aliceJid = `${aliceLocal}@${config.domain}`;
  const bobJid = `${bobLocal}@${config.domain}`;
  const roomId = `e2e-push-${suffix}`;
  const roomJid = `${roomId}@${config.mucDomain}`;
  await admin.registerUser(aliceLocal);
  await admin.registerUser(bobLocal);
  await admin.createRoom(roomId, { title: 'E2E push room' });
  await admin.setAffiliation(roomId, aliceJid, 'owner');
  await admin.setAffiliation(roomId, bobJid, 'member');

  const probe = await startPushProbe(config.domain);
  let alice: XmppClient | undefined;
  let bob: XmppClient | undefined;
  try {
    alice = await connect(
      runtime,
      aliceLocal,
      (await issueXmppToken(config, aliceJid)).token,
      'alice',
    );
    bob = await connect(runtime, bobLocal, (await issueXmppToken(config, bobJid)).token, 'bob');
    await joinRoom(alice, roomJid, 'alice', 'available');
    await joinRoom(bob, roomJid, 'bob', 'available');
    await waitForStreamManagement(alice);
    const node = nodeFor(aliceLocal);
    await enablePush(alice, `push.${config.domain}`, node);
    suspendClient(alice);
    await sleep(500);
    await bob.send(
      xml('message', { type: 'groupchat', to: roomJid }, xml('body', {}, `group-${suffix}`)),
    );
    await probe.waitForNode(node);
    return `the component received the group publish for node ${node}`;
  } finally {
    await bob?.stop().catch(() => {});
    await alice?.stop().catch(() => {});
    await probe.stop();
    await admin.destroyRoom(roomId).catch(() => {});
    await admin.unregisterUser(aliceLocal).catch(() => {});
    await admin.unregisterUser(bobLocal).catch(() => {});
  }
}

// The end-to-end run: our server registers users and a room through the admin
// API, Alice and Bob talk over XMPP, and Bob reads the history back through MAM.

const MAM_NAMESPACE = 'urn:xmpp:mam:2';
const FORWARD_NAMESPACE = 'urn:xmpp:forward:0';
const DELAY_NAMESPACE = 'urn:xmpp:delay';
const DATA_FORMS_NAMESPACE = 'jabber:x:data';

type MamMessage = { body: string; timestamp: string };

function queryRoomMam(xmpp: XmppClient, roomJid: string, queryId: string): Promise<MamMessage[]> {
  const iqId = `mam-${queryId}`;
  const messages: MamMessage[] = [];

  const deadline = withDeadline<MamMessage[]>(
    STEP_TIMEOUT_MS,
    () => new Error(`timed out waiting for the MAM result of ${roomJid}`),
  );

  xmpp.on('stanza', (stanza: XmppElement) => {
    if (deadline.settled()) return;
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
      if (stanza.attrs['type'] === 'error') {
        deadline.reject(new Error(`MAM query to ${roomJid} failed: ${xmppErrorCondition(stanza)}`));
      } else {
        deadline.resolve(messages);
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
      deadline.reject(new Error(`could not send the MAM query: ${errorMessage(error)}`));
    });

  return deadline.promise;
}

export async function main(): Promise<void> {
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
  const passwordLocal = `e2e-password-${suffix}`;
  const roomId = `e2e-${suffix}`;
  const roomJid = `${roomId}@${config.mucDomain}`;
  const aliceJid = `${aliceLocal}@${config.domain}`;
  const bobJid = `${bobLocal}@${config.domain}`;
  const carolJid = `${carolLocal}@${config.domain}`;
  const passwordJid = `${passwordLocal}@${config.domain}`;

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
    for (const localpart of [aliceLocal, bobLocal, carolLocal, passwordLocal]) {
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

  await step('negative: a non-admin account cannot log in with a known SQL password', async () => {
    const knownPassword = `known-password-${suffix}`;
    await admin.changePassword(passwordLocal, knownPassword);
    const reason = await expectLoginFails(runtime, passwordLocal, knownPassword, 'SQL password');
    console.log(`      password login answered: ${reason}`);

    const jwt = await issueXmppToken(config, passwordJid);
    const xmpp = await connect(runtime, passwordLocal, jwt.token, 'password-jwt');
    await xmpp.stop().catch(() => {});
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

  await step('push: a DM to a pending push session reaches the component (T-1357)', async () => {
    console.log(`      ${await pushPendingDm({ config, runtime, admin, prefix: 'dm-' })}`);
  });

  await step(
    'push: a group post to a pending push session reaches the component (T-1357)',
    async () => {
      console.log(`      ${await pushPendingGroup({ config, runtime, admin, prefix: 'gr-' })}`);
    },
  );

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

const invoked = process.argv[1] !== undefined && process.argv[1].endsWith('xmpp-e2e.ts');
if (invoked) {
  try {
    await main();
  } catch (error) {
    console.error(`FAIL  ${errorMessage(error)}`);
    process.exitCode = 1;
  }
}
