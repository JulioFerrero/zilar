// The end-to-end run: our server registers users and a room through the admin
// API, Alice and Bob talk over XMPP, and Bob reads the history back through MAM.
import { type XmppClient } from '@xmpp/client';
import { createEjabberdAdminClient } from '../../../../apps/server/src/xmpp/admin-client';
import { issueXmppToken } from '../../../../apps/server/src/xmpp/token';
import { type XmppConfig } from '../../../../apps/server/src/xmpp/config';
import { connect, expectLoginFails } from './connect';
import {
  collectGroupchat,
  errorMessage,
  loadEnvironment,
  sendGroupchat,
  sleep,
  waitUntil,
  websocketUrlFromApiUrl,
  type Runtime,
} from './harness';
import { queryRoomMam } from './mam';
import { joinRoom } from './muc';

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

    // The same account still logs in with a valid JWT.
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
