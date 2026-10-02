import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import type { Logger } from 'pino';
import { createApp } from './app';
import { loadServerConfig, type ServerConfig } from './config';
import type { PgliteServerDatabase } from './db/client';
import { runMigrations } from './db/migrate';
import * as schema from './db/schema';
import { createAuth, INVITE_HEADER, type Auth } from './auth/auth';
import { createInvite } from './auth/invites';
import type { OtpPurpose } from './auth/mailer';
import { createLogger } from './logger';
import type { EjabberdAdminClient } from './xmpp/admin-client';
import type {
  AddRosterItemOptions,
  CreateRoomOptions,
  RoomAffiliation,
  RosterEntry,
  SendDirectInvitationOptions,
} from './xmpp/admin-client';
import type { XmppConfig } from './xmpp/config';
import { localpartFor } from './xmpp/provisioning';

export const TEST_SECRET = 'test-better-auth-secret-0000000000000000';
export const TEST_XMPP_DOMAIN = 'zilar.localhost';
export const TEST_XMPP_MUC_DOMAIN = 'rooms.zilar.localhost';
export const TEST_XMPP_WS_URL = 'ws://127.0.0.1:5280/ws';
export const TEST_XMPP_JWT_SECRET = 'test-xmpp-jwt-secret-0000000000000000';

export class TestMailer {
  readonly sent: Array<{ email: string; code: string; purpose: OtpPurpose }> = [];

  async sendOtp(email: string, code: string, purpose: OtpPurpose): Promise<void> {
    this.sent.push({ email, code, purpose });
  }

  codeFor(email: string): string {
    const entry = [...this.sent].reverse().find((message) => message.email === email);
    if (!entry) {
      throw new Error(`No OTP was sent to ${email}`);
    }
    return entry.code;
  }
}

// In-memory stand-in for the ejabberd admin API. Tests never touch the network.
export class FakeAdminClient implements EjabberdAdminClient {
  readonly registered: string[] = [];
  readonly unregistered: string[] = [];
  readonly roomsCreated: string[] = [];
  readonly roomOptions: Array<{ roomId: string } & CreateRoomOptions> = [];
  readonly affiliations: Array<{ roomId: string; jid: string; affiliation: RoomAffiliation }> = [];
  readonly affiliationState: Map<string, Map<string, RoomAffiliation>> = new Map();
  readonly destroyedRooms: string[] = [];
  readonly roomOptionChanges: Array<{ roomId: string; name: string; value: string }> = [];
  readonly roomSubscriptions: Array<{ roomId: string; userJid: string; nick: string }> = [];
  readonly roomUnsubscriptions: Array<{ roomId: string; userJid: string }> = [];
  readonly directInvitations: Array<{
    roomId: string;
    users: string[];
    reason?: string;
    password?: string;
  }> = [];
  readonly rosterItems: Array<{
    localpart: string;
    contactJid: string;
    nick: string;
    groups: string[];
    subs: string;
  }> = [];
  readonly removedRosterItems: Array<{ localpart: string; contactJid: string }> = [];

  failRegister = false;
  failUnregister = false;
  failRoom = false;
  failAffiliation = false;
  failAffiliationRead = false;
  failDirectInvitation = false;
  failRoster = false;

  registerUser(localpart: string) {
    if (this.failRegister) {
      return Promise.reject(new Error('ejabberd is down'));
    }
    const created = !this.registered.includes(localpart);
    this.registered.push(localpart);
    return Promise.resolve({ created });
  }

  userExists(localpart: string): Promise<boolean> {
    return Promise.resolve(this.registered.includes(localpart));
  }

  unregisterUser(localpart: string): Promise<void> {
    if (this.failUnregister) {
      return Promise.reject(new Error('ejabberd is down'));
    }
    this.unregistered.push(localpart);
    const index = this.registered.indexOf(localpart);
    if (index >= 0) {
      this.registered.splice(index, 1);
    }
    return Promise.resolve();
  }

  changePassword(): Promise<void> {
    return Promise.resolve();
  }

  createRoom(roomId: string, options: CreateRoomOptions = {}) {
    if (this.failRoom) {
      return Promise.reject(new Error('ejabberd is down'));
    }
    const created = !this.roomsCreated.includes(roomId);
    this.roomsCreated.push(roomId);
    this.roomOptions.push({ roomId, ...options });
    return Promise.resolve({ created });
  }

  setAffiliation(roomId: string, jid: string, affiliation: RoomAffiliation): Promise<void> {
    if (this.failAffiliation) {
      return Promise.reject(new Error('ejabberd is down'));
    }
    this.affiliations.push({ roomId, jid, affiliation });
    let room = this.affiliationState.get(roomId);
    if (!room) {
      room = new Map();
      this.affiliationState.set(roomId, room);
    }
    if (affiliation === 'none') {
      room.delete(jid);
    } else {
      room.set(jid, affiliation);
    }
    return Promise.resolve();
  }

  getAffiliations(
    roomId: string,
  ): Promise<Array<{ jid: string; affiliation: string; reason: string }>> {
    if (this.failAffiliationRead) {
      return Promise.reject(new Error('ejabberd is down'));
    }
    const room = this.affiliationState.get(roomId);
    if (!room) {
      return Promise.resolve([]);
    }
    return Promise.resolve(
      [...room.entries()].map(([jid, affiliation]) => ({ jid, affiliation, reason: '' })),
    );
  }

  destroyRoom(roomId: string): Promise<void> {
    this.destroyedRooms.push(roomId);
    return Promise.resolve();
  }

  changeRoomOption(roomId: string, name: string, value: string): Promise<void> {
    this.roomOptionChanges.push({ roomId, name, value });
    return Promise.resolve();
  }

  subscribeRoom(roomId: string, userJid: string, nick: string): Promise<void> {
    if (this.failAffiliation) {
      return Promise.reject(new Error('ejabberd is down'));
    }
    this.roomSubscriptions.push({ roomId, userJid, nick });
    return Promise.resolve();
  }

  unsubscribeRoom(roomId: string, userJid: string): Promise<void> {
    if (this.failAffiliation) {
      return Promise.reject(new Error('ejabberd is down'));
    }
    this.roomUnsubscriptions.push({ roomId, userJid });
    return Promise.resolve();
  }

  sendDirectInvitation(
    roomId: string,
    users: string[],
    options: SendDirectInvitationOptions = {},
  ): Promise<void> {
    if (this.failDirectInvitation) {
      return Promise.reject(new Error('ejabberd is down'));
    }
    const invitation: (typeof this.directInvitations)[number] = { roomId, users };
    if (options.reason !== undefined) invitation.reason = options.reason;
    if (options.password !== undefined) invitation.password = options.password;
    this.directInvitations.push(invitation);
    return Promise.resolve();
  }

  addRosterItem(
    localpart: string,
    contactJid: string,
    options: AddRosterItemOptions,
  ): Promise<void> {
    if (this.failRoster) {
      return Promise.reject(new Error('ejabberd is down'));
    }
    this.rosterItems.push({
      localpart,
      contactJid,
      nick: options.nick,
      groups: options.groups,
      subs: options.subs ?? 'both',
    });
    return Promise.resolve();
  }

  deleteRosterItem(localpart: string, contactJid: string): Promise<void> {
    if (this.failRoster) {
      return Promise.reject(new Error('ejabberd is down'));
    }
    this.removedRosterItems.push({ localpart, contactJid });
    return Promise.resolve();
  }

  getRoster(localpart: string): Promise<RosterEntry[]> {
    const entries = this.rosterItems
      .filter((item) => item.localpart === localpart)
      .filter(
        (item) =>
          !this.removedRosterItems.some(
            (removed) =>
              removed.localpart === item.localpart && removed.contactJid === item.contactJid,
          ),
      )
      .map((item) => ({
        jid: item.contactJid,
        nick: item.nick,
        subscription: item.subs as RosterEntry['subscription'],
        pending: 'none',
        groups: item.groups,
      }));
    return Promise.resolve(entries);
  }
}

export interface TestContext {
  client: PGlite;
  db: PgliteServerDatabase;
  config: ServerConfig;
  logger: Logger;
  auth: Auth;
  mailer: TestMailer;
  adminClient: FakeAdminClient;
  xmppConfig: XmppConfig;
  logOutput: () => string;
  close: () => Promise<void>;
}

export interface TestContextOptions {
  nodeEnv?: ServerConfig['NODE_ENV'];
  mailer?: TestMailer;
  adminClient?: FakeAdminClient;
}

export function testXmppConfig(overrides: Partial<XmppConfig> = {}): XmppConfig {
  return {
    apiUrl: 'http://127.0.0.1:5280/api',
    adminJid: 'admin@zilar.localhost',
    adminPassword: 'admin-password',
    domain: TEST_XMPP_DOMAIN,
    mucDomain: TEST_XMPP_MUC_DOMAIN,
    wsPublicUrl: TEST_XMPP_WS_URL,
    jwtSecret: TEST_XMPP_JWT_SECRET,
    ...overrides,
  };
}

export function expectedJid(userId: string): string {
  return `${localpartFor(userId)}@${TEST_XMPP_DOMAIN}`;
}

const TEST_XMPP_ENV = {
  EJABBERD_API_URL: 'http://127.0.0.1:5280/api',
  EJABBERD_ADMIN_JID: 'admin@zilar.localhost',
  EJABBERD_ADMIN_PASSWORD: 'admin-password',
  XMPP_WS_PUBLIC_URL: TEST_XMPP_WS_URL,
  ZILAR_XMPP_JWT_SECRET: TEST_XMPP_JWT_SECRET,
};

export async function createTestContext(options: TestContextOptions = {}): Promise<TestContext> {
  const client = new PGlite();
  const db = drizzle(client, { schema });
  await runMigrations(db);

  const config = loadServerConfig({
    NODE_ENV: options.nodeEnv ?? 'test',
    DATABASE_URL: 'postgres://user:hunter2@127.0.0.1:5432/zilar',
    BETTER_AUTH_SECRET: TEST_SECRET,
    PUBLIC_URL: 'http://localhost:3000',
    ...TEST_XMPP_ENV,
  });

  const chunks: string[] = [];
  const logger = createLogger(config, {
    write: (message: string) => {
      chunks.push(message);
    },
  });

  const mailer = options.mailer ?? new TestMailer();
  const adminClient = options.adminClient ?? new FakeAdminClient();
  const auth = createAuth({ db, config, mailer, adminClient, logger });

  return {
    client,
    db,
    config,
    logger,
    auth,
    mailer,
    adminClient,
    xmppConfig: config.xmpp,
    logOutput: () => chunks.join(''),
    close: () => client.close(),
  };
}

export const TEST_BASE_URL = 'http://localhost:3000';

export type TestApp = ReturnType<typeof createApp>;

export function testApp(context: TestContext): TestApp {
  return createApp({
    db: context.db,
    logger: context.logger,
    config: context.config,
    auth: context.auth,
    adminClient: context.adminClient,
  });
}

export interface SignedInUser {
  cookie: string;
  bearer: string;
  id: string;
}

let clientIpCounter = 0;

// Better Auth rate-limits by client IP, so every test request gets its own.
export function nextClientIp(): string {
  clientIpCounter += 1;
  return `10.${(clientIpCounter >> 16) & 255}.${(clientIpCounter >> 8) & 255}.${clientIpCounter & 255}`;
}

// Signs a new user up through an invite, exactly as the apps do.
export async function signUpWithInvite(
  context: TestContext,
  app: TestApp,
  email: string,
  inviteCode: string,
): Promise<SignedInUser> {
  const ip = nextClientIp();
  const headers = {
    'content-type': 'application/json',
    'x-forwarded-for': ip,
    [INVITE_HEADER]: inviteCode,
  };

  await app.request(`${TEST_BASE_URL}/api/auth/email-otp/send-verification-otp`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ email, type: 'sign-in' }),
  });
  const otp = context.mailer.codeFor(email);
  const response = await app.request(`${TEST_BASE_URL}/api/auth/sign-in/email-otp`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ email, otp }),
  });
  if (response.status !== 200) {
    throw new Error(`sign-up for ${email} failed with ${response.status}`);
  }

  const body = (await response.json()) as { user: { id: string } };
  const cookie = response.headers
    .getSetCookie()
    .find((value) => value.includes('better-auth.session_token='));
  if (!cookie) {
    throw new Error(`sign-up for ${email} returned no session cookie`);
  }

  return {
    cookie: cookie.split(';')[0] ?? '',
    bearer: response.headers.get('set-auth-token') ?? '',
    id: body.user.id,
  };
}

// The first user: an invite with no creator, so no contacts are created.
export async function bootstrapUser(
  context: TestContext,
  app: TestApp,
  email: string,
): Promise<SignedInUser> {
  const invite = await createInvite(context.db, { createdBy: null });
  return signUpWithInvite(context, app, email, invite.code);
}

// A user who signs up through `inviterId`'s invite, so they become contacts.
export async function contactOf(
  context: TestContext,
  app: TestApp,
  inviterId: string,
  email: string,
): Promise<SignedInUser> {
  const invite = await createInvite(context.db, { createdBy: inviterId });
  return signUpWithInvite(context, app, email, invite.code);
}
