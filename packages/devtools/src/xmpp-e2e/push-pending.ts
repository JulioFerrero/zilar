// T-1357 reproduction for the XMPP end-to-end spike: a DM and a group post to
// a *pending* (XEP-0198 hibernated) push-enabled session must reach the push
// component.
//
// It stands in for the server's push component with a bare XEP-0114 client
// (the dev stack exposes the component listener on 127.0.0.1:5347), so the
// check needs only ejabberd: connect a fake `push.<domain>` component, enable
// XEP-0357 on a client, drop the socket below the stream so ejabberd moves the
// session to `pending`, then have another client message it and assert the
// publish IQ lands on the component.
import { createHash } from 'node:crypto';
import { connect as netConnect } from 'node:net';
import { xml, type XmppClient, type XmppElement } from '@xmpp/client';
import type { EjabberdAdminClient } from '../../../../apps/server/src/xmpp/admin/types';
import type { XmppConfig } from '../../../../apps/server/src/xmpp/config';
import { issueXmppToken } from '../../../../apps/server/src/xmpp/token';
import { connect } from './connect';
import { sleep, STEP_TIMEOUT_MS, waitUntil, withDeadline, type Runtime } from './harness';
import { joinRoom } from './muc';

const PUSH_NAMESPACE = 'urn:xmpp:push:0';
const COMPONENT_NAMESPACE = 'jabber:component:accept';
const STREAMS_NAMESPACE = 'http://etherx.jabber.org/streams';

// The dev stack publishes the component listener on 127.0.0.1:5347. A stack
// built on other ports (an isolated worktree stack) points us at its own with
// `PUSH_COMPONENT_HOST` / `PUSH_COMPONENT_PORT`.
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

export type PushProbe = {
  /** Resolves once the server has routed a publish IQ for `node` to us. */
  waitForNode: (node: string) => Promise<void>;
  stop: () => Promise<void>;
};

/**
 * A minimal XEP-0114 component (the handshake, no stanza library): it
 * authenticates as `push.<domain>` and records every `<publish node='…'>` the
 * server routes to it. Only the dev spike uses it; the real component is
 * `apps/server/src/push/component.ts`.
 */
export async function startPushProbe(domain: string): Promise<PushProbe> {
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
 * Waits until XEP-0198 stream management is negotiated. `@xmpp/client` emits
 * `online` right after resource binding, *before* it sends `<enable/>`, so
 * suspending on `online` can drop a stream that never had SM: ejabberd then
 * takes the session offline instead of `pending`, and the repro no longer
 * exercises the path the live bug is about.
 */
export async function waitForStreamManagement(xmpp: XmppClient): Promise<void> {
  const client = xmpp as unknown as { streamManagement?: { enabled?: boolean } };
  await waitUntil(
    () => client.streamManagement?.enabled === true,
    'stream management to be enabled',
  );
}

/** Drops the socket below the stream layer, like the app's `suspend()`. */
export function suspendClient(xmpp: XmppClient): void {
  const client = xmpp as unknown as {
    socket?: { end(): void } | null;
    reconnect?: { stop(): void };
  };
  client.reconnect?.stop();
  client.socket?.end();
}

/** Sends XEP-0357 `<enable/>` and resolves on the `result` IQ. */
export async function enablePush(xmpp: XmppClient, pushJid: string, node: string): Promise<void> {
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

export interface PushReproDeps {
  config: XmppConfig;
  runtime: Runtime;
  admin: EjabberdAdminClient;
  prefix: string;
}

/**
 * Registers two throwaway users, makes them contacts (SG-2's
 * `mod_block_strangers` drops a `chat` stanza without a roster subscription),
 * then: A enables push, A goes pending, B DMs A, and the component must see the
 * publish. Returns a line for the step output.
 */
export async function pushPendingDm(deps: PushReproDeps): Promise<string> {
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

/**
 * The same shape for a group: A joins a fresh members-only room, enables push,
 * goes pending, B posts to the room, and the component must see the publish.
 */
export async function pushPendingGroup(deps: PushReproDeps): Promise<string> {
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
