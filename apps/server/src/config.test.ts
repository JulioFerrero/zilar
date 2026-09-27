import { describe, expect, it } from 'vitest';
import { ConfigError, loadServerConfig } from './config';

const VALID_DATABASE_URL = 'postgres://galena:hunter2@127.0.0.1:5432/galena';
const VALID_SECRET = 'a'.repeat(32);

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
      loadServerConfig({ DATABASE_URL: VALID_DATABASE_URL, BETTER_AUTH_SECRET: VALID_SECRET }),
    ).toEqual({
      NODE_ENV: 'development',
      PORT: 3000,
      DATABASE_URL: VALID_DATABASE_URL,
      LOG_LEVEL: 'info',
      PUBLIC_URL: 'http://localhost:3000',
      BETTER_AUTH_SECRET: VALID_SECRET,
      BETTER_AUTH_URL: 'http://localhost:3000',
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
      }),
    ).toEqual({
      NODE_ENV: 'production',
      PORT: 8080,
      DATABASE_URL: 'postgresql://galena:hunter2@db.internal:5432/galena',
      LOG_LEVEL: 'debug',
      PUBLIC_URL: 'https://chat.example.com',
      BETTER_AUTH_SECRET: VALID_SECRET,
      BETTER_AUTH_URL: 'https://auth.example.com',
    });
  });

  it('defaults BETTER_AUTH_URL to PUBLIC_URL', () => {
    const config = loadServerConfig({
      DATABASE_URL: VALID_DATABASE_URL,
      BETTER_AUTH_SECRET: VALID_SECRET,
      PUBLIC_URL: 'https://galena.example.com',
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
    });

    for (const name of [
      'NODE_ENV',
      'PORT',
      'DATABASE_URL',
      'LOG_LEVEL',
      'PUBLIC_URL',
      'BETTER_AUTH_SECRET',
      'BETTER_AUTH_URL',
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
    ]) {
      expect(message).not.toContain(value);
    }
  });

  it('rejects a secret shorter than 32 characters without printing it', () => {
    const message = configErrorMessage({
      DATABASE_URL: VALID_DATABASE_URL,
      BETTER_AUTH_SECRET: 'short-secret-value',
    });
    expect(message).toContain('BETTER_AUTH_SECRET');
    expect(message).not.toContain('short-secret-value');
  });

  it('rejects a non-postgres database URL', () => {
    const message = configErrorMessage({
      DATABASE_URL: 'mysql://user:hunter2@localhost/db',
      BETTER_AUTH_SECRET: VALID_SECRET,
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
      });
      expect(message).toContain('PORT');
      if (port !== '') {
        expect(message).not.toContain(port);
      }
    }
  });

  it('accepts the port boundaries', () => {
    const base = { DATABASE_URL: VALID_DATABASE_URL, BETTER_AUTH_SECRET: VALID_SECRET };
    expect(loadServerConfig({ ...base, PORT: '1' }).PORT).toBe(1);
    expect(loadServerConfig({ ...base, PORT: '65535' }).PORT).toBe(65535);
  });
});
