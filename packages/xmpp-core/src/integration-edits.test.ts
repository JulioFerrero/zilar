// Live check for XEP-0308 corrections and XEP-0424 retractions against the dev
// stack (T-0061). Skipped unless GALENA_XMPP_INTEGRATION=1, like the other
// integration tests. It creates two throwaway users and a room.
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { createEjabberdAdminClient } from '../../../apps/server/src/xmpp/admin-client';
import { loadXmppConfig, type XmppConfig } from '../../../apps/server/src/xmpp/config';
import { issueXmppToken } from '../../../apps/server/src/xmpp/token';
import { createXmppCore } from './index';
import type { ChatMessage } from './types';

const integrationEnabled = process.env.GALENA_XMPP_INTEGRATION === '1';
const WAIT_TIMEOUT_MS = 15_000;

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

describe.skipIf(!integrationEnabled)('@galena/xmpp-core edits integration', () => {
  it('delivers and archives corrections and retractions in a DM and a group', async () => {
    const config = loadConfig();
    const service = websocketUrl(config.apiUrl);
    const domain = config.domain;
    const admin = createEjabberdAdminClient(config);

    const suffix = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    const aliceJid = `edit-alice-${suffix}@${domain}`;
    const bobJid = `edit-bob-${suffix}@${domain}`;
    const roomId = `edit-${suffix}`;
    const roomJid = `${roomId}@${config.mucDomain}`;

    await admin.registerUser(`edit-alice-${suffix}`);
    await admin.registerUser(`edit-bob-${suffix}`);
    await admin.createRoom(roomId, { title: 'edits integration room' });
    await admin.setAffiliation(roomId, aliceJid, 'owner');
    await admin.setAffiliation(roomId, bobJid, 'member');

    const tokenFor = (jid: string) => async () => ({
      jid,
      token: (await issueXmppToken(config, jid)).token,
    });
    const alice = createXmppCore({ service, domain, getToken: tokenFor(aliceJid) });
    const bob = createXmppCore({ service, domain, getToken: tokenFor(bobJid) });

    try {
      await alice.connect();
      await bob.connect();
      await alice.joinRoom(roomJid, 'alice');
      await bob.joinRoom(roomJid, 'bob');
      await waitFor(
        () => bob.occupants(roomJid).some((occupant) => occupant.realJid === aliceJid),
        'Bob to see Alice in the room',
      );

      const bobSeen: ChatMessage[] = [];
      bob.on('message', (message) => bobSeen.push(message));

      // --- DM: correct, then retract ---
      const dmId = (await alice.sendMessage(bobJid, 'chat', 'dm original')).id;
      await waitFor(
        () => bobSeen.some((message) => message.body === 'dm original'),
        'Bob to receive the DM',
      );
      const dmReceived = bobSeen.find((message) => message.body === 'dm original');
      console.log(`DM live: id=${dmReceived?.id} originId=${dmReceived?.originId} sent=${dmId}`);
      expect(dmReceived?.originId ?? dmReceived?.id).toBe(dmId);

      await alice.sendCorrection(bobJid, 'chat', dmId, 'dm edited');
      await waitFor(
        () => bobSeen.some((message) => message.correction?.targetId === dmId),
        'Bob to receive the DM correction',
      );
      const dmCorrection = bobSeen.find((message) => message.correction?.targetId === dmId);
      expect(dmCorrection?.body).toBe('dm edited');
      expect(dmCorrection?.fromJid).toBe(aliceJid);
      console.log('PASS  a DM correction arrives with the new body and the original id');

      await alice.sendRetraction(bobJid, 'chat', dmId);
      await waitFor(
        () => bobSeen.some((message) => message.retraction?.targetId === dmId),
        'Bob to receive the DM retraction',
      );
      const dmRetraction = bobSeen.find((message) => message.retraction?.targetId === dmId);
      expect(dmRetraction?.body).toBeUndefined();
      expect(dmRetraction?.fromJid).toBe(aliceJid);
      console.log('PASS  a DM retraction arrives without a fallback body');

      // --- Group: correct, then retract by stanza-id ---
      const groupOriginId = (await alice.sendMessage(roomJid, 'groupchat', 'group original')).id;
      await waitFor(
        () => bobSeen.some((message) => message.body === 'group original'),
        'Bob to receive the room message',
      );
      const groupReceived = bobSeen.find((message) => message.body === 'group original');
      console.log(
        `Group live: id=${groupReceived?.id} originId=${groupReceived?.originId} sent=${groupOriginId}`,
      );

      await alice.sendCorrection(roomJid, 'groupchat', groupOriginId, 'group edited');
      await waitFor(
        () => bobSeen.some((message) => message.correction?.targetId === groupOriginId),
        'Bob to receive the group correction',
      );
      const groupCorrection = bobSeen.find(
        (message) => message.correction?.targetId === groupOriginId,
      );
      expect(groupCorrection?.body).toBe('group edited');
      expect(groupCorrection?.fromNick).toBe('alice');
      console.log('PASS  a group correction arrives from the same occupant');

      // Groups retract by the room's stanza-id, which only history carries.
      const aliceHistory = await alice.loadHistory(roomJid, 'groupchat');
      const archivedOriginal = aliceHistory.messages.find(
        (message) => message.body === 'group original',
      );
      expect(archivedOriginal).toBeDefined();
      console.log(
        `Group archive: id=${archivedOriginal?.id} originId=${archivedOriginal?.originId}`,
      );
      const stanzaId = archivedOriginal?.id ?? '';
      await alice.sendRetraction(roomJid, 'groupchat', stanzaId);
      await waitFor(
        () => bobSeen.some((message) => message.retraction?.targetId === stanzaId),
        'Bob to receive the group retraction',
      );
      console.log('PASS  a group retraction by stanza-id arrives');

      // --- History: the archive replays both stanza kinds ---
      const bobDmHistory = await bob.loadHistory(aliceJid, 'chat');
      expect(bobDmHistory.messages.some((message) => message.correction?.targetId === dmId)).toBe(
        true,
      );
      expect(bobDmHistory.messages.some((message) => message.retraction?.targetId === dmId)).toBe(
        true,
      );
      const bobRoomHistory = await bob.loadHistory(roomJid, 'groupchat');
      expect(
        bobRoomHistory.messages.some((message) => message.correction?.targetId === groupOriginId),
      ).toBe(true);
      expect(
        bobRoomHistory.messages.some((message) => message.retraction?.targetId === stanzaId),
      ).toBe(true);
      console.log('PASS  MAM history returns the corrections and retractions in DM and group');
    } finally {
      await alice.disconnect().catch(() => undefined);
      await bob.disconnect().catch(() => undefined);
    }
  }, 60_000);
});
