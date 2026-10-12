// Log redaction (T-1179, OPS-17): every secret key the server knows about is
// censored, at the top level and one level deep, so a logged config object or
// error detail can never carry the value. Sentinels only, never a real secret.

import type { DestinationStream } from 'pino';
import { describe, expect, it } from 'vitest';
import { loadServerConfig } from './config';
import { createLogger } from './logger';
import { TEST_SECRET } from './test-support';

const baseEnv = {
  DATABASE_URL: 'postgres://user:hunter2@127.0.0.1:5432/zilar',
  BETTER_AUTH_SECRET: TEST_SECRET,
  EJABBERD_ADMIN_JID: 'admin@zilar.localhost',
  EJABBERD_ADMIN_PASSWORD: 'admin-password',
  ZILAR_XMPP_JWT_SECRET: 'x'.repeat(40),
};

// The keys T-1179 covers: the generic private-key spellings and the secret
// env names from `config.ts`, `xmpp/config.ts` and `push/config.ts`.
const NEW_KEYS = [
  'private_key',
  'privateKey',
  'FCM_SERVICE_ACCOUNT_JSON',
  'PUSH_VAPID_PRIVATE_KEY',
  'PUSH_STORAGE_KEY',
  'PUSH_COMPONENT_SECRET',
  'ZILAR_XMPP_JWT_SECRET',
  'EJABBERD_ADMIN_PASSWORD',
  'LITELLM_MASTER_KEY',
  'GITHUB_APP_PRIVATE_KEY',
  'XMPP_ARCHIVE_DATABASE_URL',
] as const;

interface Capture {
  stream: DestinationStream;
  output: () => string;
}

function capture(): Capture {
  let written = '';
  return {
    stream: {
      write: (msg: string) => {
        written += msg;
      },
    },
    output: () => written,
  };
}

describe('log redaction', () => {
  for (const key of NEW_KEYS) {
    it(`redacts ${key} at the top level and nested one level`, () => {
      const sentinel = `T-1179-${key}-sentinel`;
      const sink = capture();
      const logger = createLogger(loadServerConfig(baseEnv), sink.stream);

      logger.info({ [key]: sentinel }, 'top level');
      logger.info({ nested: { [key]: sentinel } }, 'nested');

      const output = sink.output();
      expect(output).not.toContain(sentinel);
      expect(output.split('[redacted]').length - 1).toBe(2);
    });
  }
});
