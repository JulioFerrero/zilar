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

export const TEST_SECRET = 'test-better-auth-secret-0000000000000000';

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

export interface TestContext {
  client: PGlite;
  db: PgliteServerDatabase;
  config: ServerConfig;
  logger: Logger;
  auth: Auth;
  mailer: TestMailer;
  logOutput: () => string;
  close: () => Promise<void>;
}

export interface TestContextOptions {
  nodeEnv?: ServerConfig['NODE_ENV'];
  mailer?: TestMailer;
}

export async function createTestContext(options: TestContextOptions = {}): Promise<TestContext> {
  const client = new PGlite();
  const db = drizzle(client, { schema });
  await runMigrations(db);

  const config = loadServerConfig({
    NODE_ENV: options.nodeEnv ?? 'test',
    DATABASE_URL: 'postgres://user:hunter2@127.0.0.1:5432/galena',
    BETTER_AUTH_SECRET: TEST_SECRET,
    PUBLIC_URL: 'http://localhost:3000',
  });

  const chunks: string[] = [];
  const logger = createLogger(config, {
    write: (message: string) => {
      chunks.push(message);
    },
  });

  const mailer = options.mailer ?? new TestMailer();
  const auth = createAuth({ db, config, mailer });

  return {
    client,
    db,
    config,
    logger,
    auth,
    mailer,
    logOutput: () => chunks.join(''),
    close: () => client.close(),
  };
}
