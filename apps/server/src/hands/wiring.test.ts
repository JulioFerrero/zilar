// T-1418: the desk client is built only when both the sidecar socket and the
// pinned image are set; a tag-only DESK_IMAGE is refused by the config.

import { describe, expect, it } from 'vitest';
import { ConfigError, loadServerConfig } from '../config';
import { createLogger } from '../logger';
import { TEST_SECRET } from '../test-support';
import { buildDeskClient } from './wiring';

const baseEnv = {
  DATABASE_URL: 'postgres://user:hunter2@127.0.0.1:5432/zilar',
  BETTER_AUTH_SECRET: TEST_SECRET,
  EJABBERD_ADMIN_JID: 'admin@zilar.localhost',
  EJABBERD_ADMIN_PASSWORD: 'admin-password',
  ZILAR_XMPP_JWT_SECRET: 'x'.repeat(40),
};

const DIGEST = `zilar-desk@sha256:${'a'.repeat(64)}`;

function build(env: Record<string, string | undefined>) {
  const config = loadServerConfig({ ...baseEnv, ...env });
  const logs: string[] = [];
  const logger = createLogger(config, {
    write: (line: string) => {
      logs.push(line);
    },
  });
  return { client: buildDeskClient(config, logger), logs };
}

describe('buildDeskClient', () => {
  it('is null with neither variable set', () => {
    const { client, logs } = build({});
    expect(client).toBeNull();
    expect(logs.join()).toContain('desks: off');
  });

  it('is null with only the socket set', () => {
    const { client } = build({ DESK_AGENT_SOCKET: '/run/zilar/desk.sock' });
    expect(client).toBeNull();
  });

  it('builds a client with the pinned digest when both are set', () => {
    const { client, logs } = build({
      DESK_AGENT_SOCKET: '/run/zilar/desk.sock',
      DESK_IMAGE: DIGEST,
    });
    expect(client?.imageDigest).toBe(DIGEST);
    expect(client?.hands).toBeDefined();
    expect(logs.join()).toContain('desks: on');
  });
});

describe('DESK_IMAGE', () => {
  it('refuses a tag-only image', () => {
    expect(() => loadServerConfig({ ...baseEnv, DESK_IMAGE: 'zilar-desk:dev' })).toThrow(
      ConfigError,
    );
  });
});
