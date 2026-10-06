// Integration test for @zilar/xmpp-core against the dev stack.
//
//   pnpm infra:up
//   ZILAR_XMPP_INTEGRATION=1 pnpm --filter @zilar/xmpp-core test
//   pnpm infra:down
//
// Skipped unless ZILAR_XMPP_INTEGRATION=1. It uses the server's admin client
// and JWT issuer (imported by relative path, as packages/devtools does) to
// create two users and a room, then exercises the shared client end to end.
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { Payload } from '@zilar/protocol';
import { createEjabberdAdminClient } from '../../../apps/server/src/xmpp/admin-client';
import { loadXmppConfig, type XmppConfig } from '../../../apps/server/src/xmpp/config';
import { issueXmppToken } from '../../../apps/server/src/xmpp/token';
import { createXmppCore } from './index';
import type { ChatMessage, DisplayedEvent, TypingEvent } from './types';

const integrationEnabled = process.env.ZILAR_XMPP_INTEGRATION === '1';
const WAIT_TIMEOUT_MS = 15_000;

const progress: Payload = {
  v: 0,
  type: 'progress',
  data: { ai: 'dev-1@zilar.localhost', stage: 'running the tests', percent: 40 },
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

describe.skipIf(!integrationEnabled)('@zilar/xmpp-core integration', () => {
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
      await waitFor(
        () => bob.occupants(roomJid).some((occupant) => occupant.realJid === aliceJid),
        'Bob to see Alice in the room roster',
      );
      const aliceOccupant = bob
        .occupants(roomJid)
        .find((occupant) => occupant.realJid === aliceJid);
      expect(aliceOccupant?.nick).toBe('alice');
      expect(aliceOccupant?.available).toBe(true);
      console.log(
        `PASS  both clients join the members-only room (roster: ${bob
          .occupants(roomJid)
          .map((occupant) => occupant.nick)
          .join(', ')})`,
      );

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
      // The live message has no muc#user item; the real JID is resolved from
      // the roster through the occupant-id / nick.
      expect(receivedText?.fromJid).toBe(aliceJid);
      expect(receivedText?.fromResolved).toBe(true);
      expect(receivedText?.fromNick).toBe('alice');
      expect(receivedText?.outgoing).toBe(false);
      console.log(
        `PASS  text and payload messages arrive live (fromJid=${receivedText?.fromJid}, fromResolved=${receivedText?.fromResolved}, occupantId=${receivedText?.occupantId ?? 'none'})`,
      );

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
      expect(bobDms[0]?.fromJid).toBe(aliceJid);
      expect(bobDms[0]?.fromResolved).toBe(true);
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
      const archivedText = roomHistory.messages.find((message) => message.body === 'hello room');
      expect(archivedText?.fromJid).toBe(aliceJid);
      expect(archivedText?.fromResolved).toBe(true);
      expect(archivedText?.fromNick).toBe('alice');
      console.log(
        `      history sender: fromJid=${archivedText?.fromJid} fromResolved=${archivedText?.fromResolved} fromNick=${archivedText?.fromNick} occupantId=${archivedText?.occupantId ?? 'none'}`,
      );
      console.log(
        `PASS  room history comes back oldest first (${roomHistory.messages.length} messages, complete=${roomHistory.complete})`,
      );

      const dmHistory = await bob.loadHistory(aliceJid, 'chat');
      expect(dmHistory.messages.some((message) => message.body === 'private hello')).toBe(true);
      console.log(`PASS  DM history comes back (${dmHistory.messages.length} messages)`);

      // T-0430 proof: with no cursor and a full archive, which page does MAM
      // return? XEP-0059 §2.5 says only an empty <before/> asks for the last
      // page, so the default should be the oldest one.
      for (let index = 1; index <= 40; index += 1) {
        await alice.sendMessage(bobJid, 'chat', `m${String(index).padStart(2, '0')}`);
        await sleep(20);
      }
      await sleep(1000);
      const newestPage = await bob.loadHistory(aliceJid, 'chat', { max: 10 });
      const newestBodies = newestPage.messages.map((message) => message.body);
      console.log(
        `T-0430 proof: loadHistory(chat, max=10) returned ${JSON.stringify(newestBodies)}`,
      );
      const lastArchived = newestPage.messages.at(-1);
      const lastLive = bobDms.find((message) => message.body === lastArchived?.body);
      console.log(
        `T-0430 proof: last archived body=${lastArchived?.body ?? 'none'} id=${lastArchived?.id ?? 'none'}; ` +
          `live id=${lastLive?.id ?? 'none'}`,
      );
      expect(newestBodies).toEqual([
        'm31',
        'm32',
        'm33',
        'm34',
        'm35',
        'm36',
        'm37',
        'm38',
        'm39',
        'm40',
      ]);
    } finally {
      await admin.destroyRoom(roomId).catch(() => undefined);
      await alice.disconnect().catch(() => undefined);
      await bob.disconnect().catch(() => undefined);
    }
  }, 120_000);
});
