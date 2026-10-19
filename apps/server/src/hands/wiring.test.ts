import { describe, expect, it } from 'vitest';
import { ConfigError, loadServerConfig } from '../config/load';
import { TEST_SECRET } from '../test-support';

const baseEnv = {
  DATABASE_URL: 'postgres://user:hunter2@127.0.0.1:5432/zilar',
  BETTER_AUTH_SECRET: TEST_SECRET,
  EJABBERD_ADMIN_JID: 'admin@zilar.localhost',
  EJABBERD_ADMIN_PASSWORD: 'admin-password',
  ZILAR_XMPP_JWT_SECRET: 'x'.repeat(40),
};

describe('DESK_IMAGE', () => {
  it('refuses a tag-only image', () => {
    expect(() => loadServerConfig({ ...baseEnv, DESK_IMAGE: 'zilar-desk:dev' })).toThrow(
      ConfigError,
    );
  });
});
