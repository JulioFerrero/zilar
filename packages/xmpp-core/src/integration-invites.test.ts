// Integration test for the T-0025 live updates, against the dev stack:
// a connected client receives `invited` when it is added to a group and
// `roster` when a contact is pushed to it.
//
//   pnpm infra:up
//   GALENA_XMPP_INTEGRATION=1 pnpm --filter @galena/xmpp-core test
//   pnpm infra:down
//
// Skipped unless GALENA_XMPP_INTEGRATION=1. Like integration.test.ts, it uses
// the server's admin client and JWT issuer through relative imports.
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { createEjabberdAdminClient } from '../../../apps/server/src/xmpp/admin-client';
import { loadXmppConfig, type XmppConfig } from '../../../apps/server/src/xmpp/config';
import { issueXmppToken } from '../../../apps/server/src/xmpp/token';
import { createXmppCore } from './index';
import type { InvitedEvent, RosterEvent } from './types';

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

describe.skipIf(!integrationEnabled)('@galena/xmpp-core invites and roster', () => {
  it('receives invited when added to a group and roster when a contact is added', async () => {
    const config = loadConfig();
    const service = websocketUrl(config.apiUrl);
    const domain = config.domain;
    const admin = createEjabberdAdminClient(config);

    const suffix = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    const aliceLocal = `inv-alice-${suffix}`;
    const bobLocal = `inv-bob-${suffix}`;
    const aliceJid = `${aliceLocal}@${domain}`;
    const bobJid = `${bobLocal}@${domain}`;
    const roomId = `inv-${suffix}`;
    const roomJid = `${roomId}@${config.mucDomain}`;

    await admin.registerUser(aliceLocal);
    await admin.registerUser(bobLocal);
    await admin.createRoom(roomId, { title: 'Invite integration room' });
    await admin.setAffiliation(roomId, aliceJid, 'owner');
    await admin.setAffiliation(roomId, bobJid, 'member');

    const bob = createXmppCore({
      service,
      domain,
      getToken: async () => {
        const { token } = await issueXmppToken(config, bobJid);
        return { jid: bobJid, token };
      },
    });

    const invited: InvitedEvent[] = [];
    const roster: RosterEvent[] = [];
    bob.on('invited', (event) => invited.push(event));
    bob.on('roster', (event) => roster.push(event));

    try {
      await bob.connect();
      expect(bob.status()).toBe('online');
      console.log('PASS  the invited client connects');

      await admin.addRosterItem(bobLocal, aliceJid, {
        nick: 'Alice',
        groups: ['Galena'],
        subs: 'both',
      });
      await waitFor(
        () => roster.some((event) => event.jid === aliceJid),
        'a roster push for the new contact',
      );
      const rosterEvent = roster.find((event) => event.jid === aliceJid);
      expect(rosterEvent?.subscription).toBe('both');
      console.log(
        `PASS  roster push received (jid=${rosterEvent?.jid}, subscription=${rosterEvent?.subscription}, name=${rosterEvent?.name ?? 'none'})`,
      );

      await admin.sendDirectInvitation(roomId, [bobJid], { reason: 'Join the room' });
      await waitFor(
        () => invited.some((event) => event.roomJid === roomJid),
        'a direct invitation to the room',
      );
      const invitedEvent = invited.find((event) => event.roomJid === roomJid);
      expect(invitedEvent?.reason).toBe('Join the room');
      console.log(
        `PASS  direct invitation received (roomJid=${invitedEvent?.roomJid}, fromJid=${invitedEvent?.fromJid ?? 'none'}, reason=${invitedEvent?.reason ?? 'none'})`,
      );
    } finally {
      await admin.destroyRoom(roomId).catch(() => undefined);
      await admin.deleteRosterItem(bobLocal, aliceJid).catch(() => undefined);
      await bob.disconnect().catch(() => undefined);
    }
  }, 60_000);
});
