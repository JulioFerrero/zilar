import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import type { Logger } from 'pino';
import { loadServerConfig, type ServerConfig } from './config';
import type { PgliteServerDatabase } from './db/client';
import { runMigrations } from './db/migrate';
import * as schema from './db/schema';
import { createAuth, type Auth } from './auth/auth';
import type { OtpPurpose } from './auth/mailer';
import { createLogger } from './logger';
import type { EjabberdAdminClient } from './xmpp/admin-client';
import type { XmppConfig } from './xmpp/config';
import { localpartFor } from './xmpp/provisioning';

export const TEST_SECRET = 'test-better-auth-secret-0000000000000000';
export const TEST_XMPP_DOMAIN = 'galena.localhost';
export const TEST_XMPP_MUC_DOMAIN = 'rooms.galena.localhost';
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
  readonly roomsCreated: string[] = [];
  failRegister = false;

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

  changePassword(): Promise<void> {
    return Promise.resolve();
  }

  createRoom(roomId: string) {
    const created = !this.roomsCreated.includes(roomId);
    this.roomsCreated.push(roomId);
    return Promise.resolve({ created });
  }

  setAffiliation(): Promise<void> {
    return Promise.resolve();
  }

  getAffiliations() {
    return Promise.resolve([]);
  }

  destroyRoom(): Promise<void> {
    return Promise.resolve();
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
    adminJid: 'admin@galena.localhost',
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
  EJABBERD_ADMIN_JID: 'admin@galena.localhost',
  EJABBERD_ADMIN_PASSWORD: 'admin-password',
  XMPP_WS_PUBLIC_URL: TEST_XMPP_WS_URL,
  GALENA_XMPP_JWT_SECRET: TEST_XMPP_JWT_SECRET,
};

export async function createTestContext(options: TestContextOptions = {}): Promise<TestContext> {
  const client = new PGlite();
  const db = drizzle(client, { schema });
  await runMigrations(db);

  const config = loadServerConfig({
    NODE_ENV: options.nodeEnv ?? 'test',
    DATABASE_URL: 'postgres://user:hunter2@127.0.0.1:5432/galena',
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
