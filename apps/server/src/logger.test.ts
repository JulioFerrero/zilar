import { describe, expect, it } from 'vitest';
import { loadServerConfig } from './config';
import { createLogger } from './logger';

function captureLog(payload: Record<string, unknown>): string {
  const chunks: string[] = [];
  const destination = {
    write: (message: string): void => {
      chunks.push(message);
    },
  };
  const config = loadServerConfig({
    NODE_ENV: 'test',
    DATABASE_URL: 'postgres://user:hunter2@127.0.0.1:5432/zilar',
    BETTER_AUTH_SECRET: 'test-secret-test-secret-test-secret',
    EJABBERD_ADMIN_JID: 'admin@zilar.localhost',
    EJABBERD_ADMIN_PASSWORD: 'admin-password',
    ZILAR_XMPP_JWT_SECRET: 'x'.repeat(40),
  });

  createLogger(config, destination).info(payload, 'test');
  return chunks.join('');
}

describe('createLogger', () => {
  it('redacts sensitive fields from the output', () => {
    const output = captureLog({
      password: 'hunter2',
      token: 'abc123',
      secret: 'shhh',
      apiKey: 'key-one',
      api_key: 'key-two',
      req: { headers: { authorization: 'Bearer xyz', cookie: 'session=1' } },
      DATABASE_URL: 'postgres://user:hunter2@127.0.0.1:5432/zilar',
    });

    for (const value of [
      'hunter2',
      'abc123',
      'shhh',
      'key-one',
      'key-two',
      'Bearer xyz',
      'session=1',
    ]) {
      expect(output).not.toContain(value);
    }
    expect(output).toContain('[redacted]');
  });
});
