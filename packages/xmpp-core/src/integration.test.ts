// Integration test for @galena/xmpp-core against the dev stack.
//
//   pnpm infra:up
//   GALENA_XMPP_INTEGRATION=1 pnpm --filter @galena/xmpp-core test
//   pnpm infra:down
//
// Skipped unless GALENA_XMPP_INTEGRATION=1. It uses the server's admin client
// and JWT issuer (imported by relative path, as packages/devtools does) to
// create two users and a room, then exercises the shared client end to end.
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { Payload } from '@galena/protocol';
import { createEjabberdAdminClient } from '../../../apps/server/src/xmpp/admin-client';
import { loadXmppConfig, type XmppConfig } from '../../../apps/server/src/xmpp/config';
import { issueXmppToken } from '../../../apps/server/src/xmpp/token';
import { createXmppCore } from './index';
import type { ChatMessage, DisplayedEvent, TypingEvent } from './types';

const integrationEnabled = process.env.GALENA_XMPP_INTEGRATION === '1';
const WAIT_TIMEOUT_MS = 15_000;

const progress: Payload = {
  v: 0,
  type: 'progress',
  data: { ai: 'dev-1@galena.localhost', stage: 'running the tests', percent: 40 },
};

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

async function waitFor(predicate: () => boolean, description: string): Promise<void> {
  const deadline = Date.now() + WAIT_TIMEOUT_MS;
  while (!predicate()) {
    if (Date.now() > deadline) {
      throw new Error(`timed out waiting for ${description}`);
    }
    await sleep(50);
  }
}

describe.skipIf(!integrationEnabled)('@galena/xmpp-core integration', () => {
  it('joins a room, sends messages and payloads, reconnects with a fresh token and loads history', async () => {
    const config = loadConfig();
    const service = websocketUrl(config.apiUrl);
    const domain = config.domain;
    const admin = createEjabberdAdminClient(config);

    const suffix = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    const aliceLocal = `core-alice-${suffix}`;
    const bobLocal = `core-bob-${suffix}`;
    const aliceJid = `${aliceLocal}@${domain}`;
    const bobJid = `${bobLocal}@${domain}`;
    const roomId = `core-${suffix}`;
    const roomJid = `${roomId}@${config.mucDomain}`;

    await admin.registerUser(aliceLocal);
    await admin.registerUser(bobLocal);
    await admin.createRoom(roomId, { title: 'xmpp-core integration room' });
    await admin.setAffiliation(roomId, aliceJid, 'owner');
    await admin.setAffiliation(roomId, bobJid, 'member');

    const tokenCounts = { alice: 0, bob: 0 };
    function tokenSource(
      jid: string,
      key: 'alice' | 'bob',
    ): () => Promise<{
      jid: string;
      token: string;
    }> {
      return async () => {
        tokenCounts[key] += 1;
        const { token } = await issueXmppToken(config, jid);
        return { jid, token };
      };
    }

    const alice = createXmppCore({ service, domain, getToken: tokenSource(aliceJid, 'alice') });
    const bob = createXmppCore({ service, domain, getToken: tokenSource(bobJid, 'bob') });

    try {
      console.log(`\nintegration room: ${roomJid}`);

      await alice.connect();
      await bob.connect();
      expect(alice.status()).toBe('online');
      expect(bob.status()).toBe('online');
      expect(alice.me()).toBe(aliceJid);
      console.log('PASS  both clients connect with a JWT');

      await alice.joinRoom(roomJid, 'alice');
      await bob.joinRoom(roomJid, 'bob');
      console.log('PASS  both clients join the members-only room');

      const bobRoomMessages: ChatMessage[] = [];
      bob.on('message', (message) => {
        if (message.chatJid === roomJid) bobRoomMessages.push(message);
      });
      const textId = (await alice.sendMessage(roomJid, 'groupchat', 'hello room')).id;
      await alice.sendMessage(roomJid, 'groupchat', 'progress update', { payload: progress });
      await waitFor(
        () => bobRoomMessages.some((message) => message.body === 'progress update'),
        'Bob to receive both room messages',
      );

      const receivedPayload = bobRoomMessages.find((message) => message.body === 'progress update');
      expect(receivedPayload?.payload).toEqual(progress);
      const receivedText = bobRoomMessages.find((message) => message.body === 'hello room');
      // ejabberd 26.07 does not add the muc#user item to live groupchat
      // messages, so the sender falls back to the occupant JID (the real JID
      // is learned from the room presence roster, a later task).
      expect([aliceJid, `${roomJid}/alice`]).toContain(receivedText?.fromJid);
      expect(receivedText?.fromNick).toBe('alice');
      expect(receivedText?.outgoing).toBe(false);
      console.log('PASS  text and payload messages arrive live');

      const typing: TypingEvent[] = [];
      alice.on('typing', (event) => typing.push(event));
      bob.sendTyping(roomJid, 'groupchat', 'composing');
      await waitFor(
        () => typing.some((event) => event.state === 'composing' && event.chatJid === roomJid),
        'Alice to receive the typing indicator',
      );

      const displayed: DisplayedEvent[] = [];
      alice.on('displayed', (event) => displayed.push(event));
      bob.markDisplayed(roomJid, 'groupchat', textId);
      await waitFor(
        () => displayed.some((event) => event.messageId === textId),
        'Alice to receive the displayed marker',
      );
      console.log('PASS  typing and displayed markers arrive');

      const bobDms: ChatMessage[] = [];
      bob.on('message', (message) => {
        if (message.kind === 'chat' && message.chatJid === aliceJid) bobDms.push(message);
      });
      await alice.sendMessage(bobJid, 'chat', 'private hello');
      await waitFor(() => bobDms.length > 0, 'Bob to receive the DM');
      console.log('PASS  a direct message arrives');

      expect(tokenCounts.bob).toBe(1);
      await bob.disconnect();
      expect(bob.status()).toBe('offline');
      await bob.connect();
      expect(tokenCounts.bob).toBe(2);
      expect(bob.status()).toBe('online');
      // The client rejoins on its own after the reconnect.
      await sleep(1000);
      console.log('PASS  reconnect fetches a fresh token (getToken called twice)');

      const roomHistory = await bob.loadHistory(roomJid, 'groupchat');
      const bodies = roomHistory.messages.map((message) => message.body);
      const textIndex = bodies.indexOf('hello room');
      const payloadIndex = bodies.indexOf('progress update');
      expect(textIndex).toBeGreaterThanOrEqual(0);
      expect(payloadIndex).toBeGreaterThan(textIndex);
      for (let index = 1; index < roomHistory.messages.length; index += 1) {
        const previous = roomHistory.messages[index - 1]!;
        const current = roomHistory.messages[index]!;
        expect(current.timestamp.getTime()).toBeGreaterThanOrEqual(previous.timestamp.getTime());
      }
      const archivedPayload = roomHistory.messages.find(
        (message) => message.body === 'progress update',
      );
      expect(archivedPayload?.payload).toEqual(progress);
      console.log(
        `PASS  room history comes back oldest first (${roomHistory.messages.length} messages, complete=${roomHistory.complete})`,
      );

      const dmHistory = await bob.loadHistory(aliceJid, 'chat');
      expect(dmHistory.messages.some((message) => message.body === 'private hello')).toBe(true);
      console.log(`PASS  DM history comes back (${dmHistory.messages.length} messages)`);
    } finally {
      await admin.destroyRoom(roomId).catch(() => undefined);
      await alice.disconnect().catch(() => undefined);
      await bob.disconnect().catch(() => undefined);
    }
  }, 120_000);
});
