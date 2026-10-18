// T-1603: the desk probe is always built (the socket path has a default); the
// server asks the agent instead of guessing from DESK_IMAGE. `DESK_IMAGE`
// stays an optional override for an old agent.

import { describe, expect, it } from 'vitest';
import { ConfigError, loadServerConfig } from '../config/load';
import { createLogger } from '../logger';
import { TEST_SECRET } from '../test-support';
import { buildDeskProbe } from '../startup/components';

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
  return { config, probe: buildDeskProbe(config, logger), logs };
}

describe('buildDeskProbe', () => {
  it('always returns a probe', () => {
    const { probe } = build({});
    expect(typeof probe).toBe('function');
  });

  it('asks the agent: a missing socket answers null without throwing', async () => {
    const { probe } = build({ DESK_AGENT_SOCKET: '/run/zilar/does-not-exist.sock' });
    await expect(probe()).resolves.toBeNull();
  });
});

describe('DESK_AGENT_SOCKET', () => {
  it('defaults to the agent socket', () => {
    const { config } = build({});
    expect(config.DESK_AGENT_SOCKET).toBe('/run/zilar/desk.sock');
  });
});

describe('DESK_IMAGE', () => {
  it('refuses a tag-only image', () => {
    expect(() => loadServerConfig({ ...baseEnv, DESK_IMAGE: 'zilar-desk:dev' })).toThrow(
      ConfigError,
    );
  });

  it('accepts a pinned image as the override', () => {
    const { config } = build({ DESK_IMAGE: DIGEST });
    expect(config.DESK_IMAGE).toBe(DIGEST);
  });
});
