import { describe, expect, it } from 'vitest';
import { loadServerConfig, type ServerConfig } from '../config/load';
import { CLIENT_IP_HEADER } from '../http/client-ip';
import { createLogger } from '../logger';
import {
  TEST_SECRET,
  TEST_XMPP_DOMAIN,
  TEST_XMPP_JWT_SECRET,
  TEST_XMPP_WS_URL,
} from '../test-support';
import { createEdge } from './edge';

const BASE_URL = 'http://localhost:3000';

function configWithHops(hops: number): ServerConfig {
  return loadServerConfig({
    NODE_ENV: 'test',
    DATABASE_URL: 'postgres://user:hunter2@127.0.0.1:5432/zilar',
    BETTER_AUTH_SECRET: TEST_SECRET,
    PUBLIC_URL: 'http://localhost:3000',
    EJABBERD_API_URL: 'http://127.0.0.1:5280/api',
    EJABBERD_ADMIN_JID: 'admin@zilar.localhost',
    EJABBERD_ADMIN_PASSWORD: 'admin-password',
    XMPP_WS_PUBLIC_URL: TEST_XMPP_WS_URL,
    ZILAR_XMPP_JWT_SECRET: TEST_XMPP_JWT_SECRET,
    XMPP_DOMAIN: TEST_XMPP_DOMAIN,
    TRUSTED_PROXY_HOPS: String(hops),
  });
}

// Captures what the auth handler receives: the edge is the only writer of
// CLIENT_IP_HEADER, so this is what Better Auth reads for its rate limits and
// the session IP.
function edgeWithAuthCapture(hops: number): {
  request: (headers: Record<string, string>) => Promise<string | null>;
} {
  const config = configWithHops(hops);
  let seen: string | null = null;
  const edge = createEdge({
    mounts: [],
    auth: {
      handler: (request: Request) => {
        seen = request.headers.get(CLIENT_IP_HEADER);
        return Promise.resolve(
          new Response('{}', { headers: { 'content-type': 'application/json' } }),
        );
      },
    },
    config,
    logger: createLogger(config, { write: () => undefined }),
    health: () => Promise.resolve({ status: 200, body: { ok: true } }),
  });
  return {
    request: async (headers) => {
      const response = await edge.request(`${BASE_URL}/api/auth/ok`, { headers });
      expect(response.status).toBe(200);
      return seen;
    },
  };
}

describe('edge client IP for Better Auth (T-1983)', () => {
  it('overwrites a client-supplied x-zilar-client-ip', async () => {
    const auth = edgeWithAuthCapture(2);
    const ip = await auth.request({
      'x-forwarded-for': '1.2.3.4, 10.0.0.2',
      [CLIENT_IP_HEADER]: '9.9.9.9',
    });
    expect(ip).toBe('1.2.3.4');
  });

  it('resolves the visitor from x-forwarded-for with two trusted hops', async () => {
    const auth = edgeWithAuthCapture(2);
    const ip = await auth.request({ 'x-forwarded-for': '1.2.3.4, 10.0.0.2' });
    expect(ip).toBe('1.2.3.4');
  });
});
