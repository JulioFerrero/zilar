import { describe, expect, it } from 'vitest';
import { ConfigError, loadServerConfig } from './config';

const VALID_DATABASE_URL = 'postgres://galena:hunter2@127.0.0.1:5432/galena';
const VALID_SECRET = 'a'.repeat(32);

const VALID_XMPP_ENV = {
  EJABBERD_ADMIN_JID: 'admin@galena.localhost',
  EJABBERD_ADMIN_PASSWORD: 'admin-password',
  GALENA_XMPP_JWT_SECRET: 'x'.repeat(40),
};

const VALID_XMPP = {
  apiUrl: 'http://127.0.0.1:5280/api',
  adminJid: 'admin@galena.localhost',
  adminPassword: 'admin-password',
  domain: 'galena.localhost',
  mucDomain: 'rooms.galena.localhost',
  wsPublicUrl: 'ws://127.0.0.1:5280/ws',
  jwtSecret: 'x'.repeat(40),
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

describe('loadServerConfig', () => {
  it('applies defaults and parses a valid environment', () => {
    expect(
      loadServerConfig({
        DATABASE_URL: VALID_DATABASE_URL,
        BETTER_AUTH_SECRET: VALID_SECRET,
        ...VALID_XMPP_ENV,
      }),
    ).toEqual({
      NODE_ENV: 'development',
      PORT: 3000,
      DATABASE_URL: VALID_DATABASE_URL,
      LOG_LEVEL: 'info',
      PUBLIC_URL: 'http://localhost:3000',
      BETTER_AUTH_SECRET: VALID_SECRET,
      BETTER_AUTH_URL: 'http://localhost:3000',
      WEB_ORIGINS: ['http://localhost:5173'],
      AGENT_GATEWAY_ENABLED: false,
      RUNNER_HUB_ENABLED: false,
      RUNNER_HUB_PORT: 3189,
      ACTION_DEMO_ENABLED: false,
      xmpp: VALID_XMPP,
    });
  });

  it('parses explicit values', () => {
    expect(
      loadServerConfig({
        NODE_ENV: 'production',
        PORT: '8080',
        DATABASE_URL: 'postgresql://galena:hunter2@db.internal:5432/galena',
        LOG_LEVEL: 'debug',
        PUBLIC_URL: 'https://chat.example.com',
        BETTER_AUTH_SECRET: VALID_SECRET,
        BETTER_AUTH_URL: 'https://auth.example.com',
        WEB_ORIGINS: 'https://app.example.com, https://admin.example.com',
        ...VALID_XMPP_ENV,
      }),
    ).toEqual({
      NODE_ENV: 'production',
      PORT: 8080,
      DATABASE_URL: 'postgresql://galena:hunter2@db.internal:5432/galena',
      LOG_LEVEL: 'debug',
      PUBLIC_URL: 'https://chat.example.com',
      BETTER_AUTH_SECRET: VALID_SECRET,
      BETTER_AUTH_URL: 'https://auth.example.com',
      WEB_ORIGINS: ['https://app.example.com', 'https://admin.example.com'],
      AGENT_GATEWAY_ENABLED: false,
      RUNNER_HUB_ENABLED: false,
      RUNNER_HUB_PORT: 3189,
      ACTION_DEMO_ENABLED: false,
      xmpp: VALID_XMPP,
    });
  });

  it('surfaces a missing XMPP variable without printing a value', () => {
    const message = configErrorMessage({
      DATABASE_URL: VALID_DATABASE_URL,
      BETTER_AUTH_SECRET: VALID_SECRET,
    });
    expect(message).toContain('EJABBERD_ADMIN_JID');
    expect(message).toContain('GALENA_XMPP_JWT_SECRET');
    expect(message).not.toContain('admin-password');
  });

  it('normalizes web origins to their origin', () => {
    const config = loadServerConfig({
      DATABASE_URL: VALID_DATABASE_URL,
      BETTER_AUTH_SECRET: VALID_SECRET,
      WEB_ORIGINS: 'http://localhost:5173/, https://app.example.com/some/path?x=1',
      ...VALID_XMPP_ENV,
    });
    expect(config.WEB_ORIGINS).toEqual(['http://localhost:5173', 'https://app.example.com']);
  });

  it('rejects invalid web origins without printing them', () => {
    const message = configErrorMessage({
      DATABASE_URL: VALID_DATABASE_URL,
      BETTER_AUTH_SECRET: VALID_SECRET,
      WEB_ORIGINS: 'https://app.example.com,not-an-origin',
      ...VALID_XMPP_ENV,
    });
    expect(message).toContain('WEB_ORIGINS');
    expect(message).not.toContain('not-an-origin');
  });

  it('rejects an empty web origin list', () => {
    const message = configErrorMessage({
      DATABASE_URL: VALID_DATABASE_URL,
      BETTER_AUTH_SECRET: VALID_SECRET,
      WEB_ORIGINS: '',
      ...VALID_XMPP_ENV,
    });
    expect(message).toContain('WEB_ORIGINS');
  });

  it('defaults BETTER_AUTH_URL to PUBLIC_URL', () => {
    const config = loadServerConfig({
      DATABASE_URL: VALID_DATABASE_URL,
      BETTER_AUTH_SECRET: VALID_SECRET,
      PUBLIC_URL: 'https://galena.example.com',
      ...VALID_XMPP_ENV,
    });
    expect(config.BETTER_AUTH_URL).toBe('https://galena.example.com');
  });

  it('lists every missing required variable without printing values', () => {
    const message = configErrorMessage({});
    expect(message).toContain('DATABASE_URL');
    expect(message).toContain('BETTER_AUTH_SECRET');
    expect(message).toContain('missing');
  });

  it('lists every invalid variable without printing any value', () => {
    const message = configErrorMessage({
      NODE_ENV: 'nope',
      PORT: 'abc',
      DATABASE_URL: 'mysql://galena:hunter2@127.0.0.1:3306/galena',
      LOG_LEVEL: 'loud',
      PUBLIC_URL: 'not-a-url',
      BETTER_AUTH_SECRET: 'too-short-to-be-a-valid-secret',
      BETTER_AUTH_URL: 'also-not-a-url',
      WEB_ORIGINS: 'not-an-origin',
    });

    for (const name of [
      'NODE_ENV',
      'PORT',
      'DATABASE_URL',
      'LOG_LEVEL',
      'PUBLIC_URL',
      'BETTER_AUTH_SECRET',
      'BETTER_AUTH_URL',
      'WEB_ORIGINS',
    ]) {
      expect(message).toContain(name);
    }
    for (const value of [
      'nope',
      'abc',
      'hunter2',
      'loud',
      'not-a-url',
      'too-short-to-be-a-valid-secret',
      'also-not-a-url',
      'not-an-origin',
    ]) {
      expect(message).not.toContain(value);
    }
  });

  it('rejects a secret shorter than 32 characters without printing it', () => {
    const message = configErrorMessage({
      DATABASE_URL: VALID_DATABASE_URL,
      BETTER_AUTH_SECRET: 'short-secret-value',
      ...VALID_XMPP_ENV,
    });
    expect(message).toContain('BETTER_AUTH_SECRET');
    expect(message).not.toContain('short-secret-value');
  });

  it('rejects a non-postgres database URL', () => {
    const message = configErrorMessage({
      DATABASE_URL: 'mysql://user:hunter2@localhost/db',
      BETTER_AUTH_SECRET: VALID_SECRET,
      ...VALID_XMPP_ENV,
    });
    expect(message).toContain('DATABASE_URL');
    expect(message).not.toContain('hunter2');
    expect(message).not.toContain('mysql');
  });

  it('rejects invalid ports', () => {
    for (const port of ['abc', '0', '65536', '12.5', '']) {
      const message = configErrorMessage({
        DATABASE_URL: VALID_DATABASE_URL,
        BETTER_AUTH_SECRET: VALID_SECRET,
        PORT: port,
        ...VALID_XMPP_ENV,
      });
      expect(message).toContain('PORT');
      if (port !== '') {
        expect(message).not.toContain(port);
      }
    }
  });

  it('accepts the port boundaries', () => {
    const base = {
      DATABASE_URL: VALID_DATABASE_URL,
      BETTER_AUTH_SECRET: VALID_SECRET,
      ...VALID_XMPP_ENV,
    };
    expect(loadServerConfig({ ...base, PORT: '1' }).PORT).toBe(1);
    expect(loadServerConfig({ ...base, PORT: '65535' }).PORT).toBe(65535);
  });

  it('leaves the agent gateway off by default and enables it with one line', () => {
    const base = {
      DATABASE_URL: VALID_DATABASE_URL,
      BETTER_AUTH_SECRET: VALID_SECRET,
      ...VALID_XMPP_ENV,
    };
    expect(loadServerConfig(base).AGENT_GATEWAY_ENABLED).toBe(false);
    expect(loadServerConfig({ ...base, AGENT_GATEWAY_ENABLED: 'true' }).AGENT_GATEWAY_ENABLED).toBe(
      true,
    );
  });

  it('leaves the demo action off by default and enables it with one line', () => {
    const base = {
      DATABASE_URL: VALID_DATABASE_URL,
      BETTER_AUTH_SECRET: VALID_SECRET,
      ...VALID_XMPP_ENV,
    };
    expect(loadServerConfig(base).ACTION_DEMO_ENABLED).toBe(false);
    expect(loadServerConfig({ ...base, ACTION_DEMO_ENABLED: 'true' }).ACTION_DEMO_ENABLED).toBe(
      true,
    );
  });

  it('rejects junk values for ACTION_DEMO_ENABLED like the sibling flags', () => {
    const base = {
      DATABASE_URL: VALID_DATABASE_URL,
      BETTER_AUTH_SECRET: VALID_SECRET,
      ...VALID_XMPP_ENV,
    };
    const message = configErrorMessage({ ...base, ACTION_DEMO_ENABLED: 'maybe' });
    expect(message).toContain('ACTION_DEMO_ENABLED');
    expect(message).not.toContain('maybe');
  });

  it('leaves the runner hub off by default on port 3189', () => {
    const base = {
      DATABASE_URL: VALID_DATABASE_URL,
      BETTER_AUTH_SECRET: VALID_SECRET,
      ...VALID_XMPP_ENV,
    };
    const config = loadServerConfig(base);
    expect(config.RUNNER_HUB_ENABLED).toBe(false);
    expect(config.RUNNER_HUB_PORT).toBe(3189);
  });

  it('enables the runner hub with one line and accepts a custom port', () => {
    const base = {
      DATABASE_URL: VALID_DATABASE_URL,
      BETTER_AUTH_SECRET: VALID_SECRET,
      ...VALID_XMPP_ENV,
    };
    expect(loadServerConfig({ ...base, RUNNER_HUB_ENABLED: 'true' }).RUNNER_HUB_ENABLED).toBe(true);
    expect(
      loadServerConfig({ ...base, RUNNER_HUB_ENABLED: 'true', RUNNER_HUB_PORT: '4000' })
        .RUNNER_HUB_PORT,
    ).toBe(4000);
  });

  it('accepts the runner-hub port boundaries', () => {
    const base = {
      DATABASE_URL: VALID_DATABASE_URL,
      BETTER_AUTH_SECRET: VALID_SECRET,
      ...VALID_XMPP_ENV,
    };
    expect(
      loadServerConfig({ ...base, RUNNER_HUB_ENABLED: 'true', RUNNER_HUB_PORT: '1' })
        .RUNNER_HUB_PORT,
    ).toBe(1);
    expect(
      loadServerConfig({ ...base, RUNNER_HUB_ENABLED: 'true', RUNNER_HUB_PORT: '65535' })
        .RUNNER_HUB_PORT,
    ).toBe(65535);
  });

  it('rejects an out-of-range runner-hub port', () => {
    for (const port of ['0', '65536', '12.5']) {
      const message = configErrorMessage({
        DATABASE_URL: VALID_DATABASE_URL,
        BETTER_AUTH_SECRET: VALID_SECRET,
        RUNNER_HUB_PORT: port,
        ...VALID_XMPP_ENV,
      });
      expect(message).toContain('RUNNER_HUB_PORT');
      expect(message).not.toContain(port);
    }
  });
});
