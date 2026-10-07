import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';
import { ConfigError, ServerConfig, ServerConfigLive, loadServerConfig } from './config';

const VALID_DATABASE_URL = 'postgres://zilar:hunter2@127.0.0.1:5432/zilar';
const VALID_SECRET = 'a'.repeat(32);

const VALID_XMPP_ENV = {
  EJABBERD_ADMIN_JID: 'admin@zilar.localhost',
  EJABBERD_ADMIN_PASSWORD: 'admin-password',
  ZILAR_XMPP_JWT_SECRET: 'x'.repeat(40),
};

function configErrorMessage(env: Record<string, string | undefined>): string {
  try {
    loadServerConfig(env);
  } catch (error) {
    if (error instanceof ConfigError) {
      return error.message;
    }
    throw error;
  }
  throw new Error('expected loadServerConfig to throw');
}

describe('ServerConfigLive', () => {
  it('provides the config parsed from process.env', async () => {
    const additions = {
      DATABASE_URL: VALID_DATABASE_URL,
      BETTER_AUTH_SECRET: VALID_SECRET,
      PORT: '3456',
      ...VALID_XMPP_ENV,
    };
    const previous = new Map<string, string | undefined>();
    for (const [key, value] of Object.entries(additions)) {
      previous.set(key, process.env[key]);
      process.env[key] = value;
    }

    try {
      const config = await Effect.runPromise(
        Effect.gen(function* () {
          return yield* ServerConfig;
        }).pipe(Effect.provide(ServerConfigLive)),
      );

      expect(config.PORT).toBe(3456);
      expect(config.DATABASE_URL).toBe(VALID_DATABASE_URL);
      expect(config.xmpp.adminJid).toBe('admin@zilar.localhost');
    } finally {
      for (const [key, value] of previous) {
        if (value === undefined) {
          delete process.env[key];
        } else {
          process.env[key] = value;
        }
      }
    }
  });
});

describe('secret-free config errors', () => {
  it('names BETTER_AUTH_SECRET without printing its value', () => {
    const value = 'short-secret-value';
    const message = configErrorMessage({
      DATABASE_URL: VALID_DATABASE_URL,
      BETTER_AUTH_SECRET: value,
      ...VALID_XMPP_ENV,
    });
    expect(message).toContain('BETTER_AUTH_SECRET');
    expect(message).not.toContain(value);
  });

  it('names DATABASE_URL without printing its value', () => {
    const message = configErrorMessage({
      DATABASE_URL: 'mysql://user:hunter2@localhost/db',
      BETTER_AUTH_SECRET: VALID_SECRET,
      ...VALID_XMPP_ENV,
    });
    expect(message).toContain('DATABASE_URL');
    expect(message).not.toContain('hunter2');
  });

  it('names SMTP_PASSWORD without printing its value', () => {
    const value = 'smtp-password-value';
    const message = configErrorMessage({
      DATABASE_URL: VALID_DATABASE_URL,
      BETTER_AUTH_SECRET: VALID_SECRET,
      MAIL_TRANSPORT: 'smtp',
      SMTP_HOST: 'smtp.example.com',
      MAIL_FROM: 'no-reply@example.com',
      SMTP_PASSWORD: value,
      ...VALID_XMPP_ENV,
    });
    expect(message).toContain('SMTP_PASSWORD');
    expect(message).not.toContain(value);
  });
});
