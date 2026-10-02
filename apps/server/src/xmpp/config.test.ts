import { describe, expect, it } from 'vitest';
import { loadXmppConfig } from './config';

const validEnv = {
  EJABBERD_API_URL: 'http://127.0.0.1:5280/api',
  EJABBERD_ADMIN_JID: 'admin@zilar.localhost',
  EJABBERD_ADMIN_PASSWORD: 'admin-password',
  XMPP_DOMAIN: 'zilar.localhost',
  XMPP_MUC_DOMAIN: 'rooms.zilar.localhost',
  XMPP_WS_PUBLIC_URL: 'ws://127.0.0.1:5280/ws',
  ZILAR_XMPP_JWT_SECRET: 'a'.repeat(40),
};

function captureError(action: () => unknown): Error {
  try {
    action();
  } catch (error) {
    if (error instanceof Error) {
      return error;
    }
    throw error;
  }
  throw new Error('expected the action to throw');
}

describe('loadXmppConfig', () => {
  it('loads a complete environment', () => {
    expect(loadXmppConfig(validEnv)).toEqual({
      apiUrl: 'http://127.0.0.1:5280/api',
      adminJid: 'admin@zilar.localhost',
      adminPassword: 'admin-password',
      domain: 'zilar.localhost',
      mucDomain: 'rooms.zilar.localhost',
      wsPublicUrl: 'ws://127.0.0.1:5280/ws',
      jwtSecret: 'a'.repeat(40),
    });
  });

  it('applies the default URL and domains', () => {
    const config = loadXmppConfig({
      EJABBERD_ADMIN_JID: 'admin@zilar.localhost',
      EJABBERD_ADMIN_PASSWORD: 'admin-password',
      ZILAR_XMPP_JWT_SECRET: 'b'.repeat(40),
    });
    expect(config.apiUrl).toBe('http://127.0.0.1:5280/api');
    expect(config.domain).toBe('zilar.localhost');
    expect(config.mucDomain).toBe('rooms.zilar.localhost');
    expect(config.wsPublicUrl).toBe('ws://127.0.0.1:5280/ws');
  });

  it('rejects a WebSocket URL that is not ws:// or wss://', () => {
    const error = captureError(() =>
      loadXmppConfig({ ...validEnv, XMPP_WS_PUBLIC_URL: 'http://127.0.0.1:5280/ws' }),
    );
    expect(error.message).toContain('XMPP_WS_PUBLIC_URL');
  });

  it('strips trailing slashes from the API URL', () => {
    const config = loadXmppConfig({ ...validEnv, EJABBERD_API_URL: 'http://host:5280/api///' });
    expect(config.apiUrl).toBe('http://host:5280/api');
  });

  it('lists every missing or invalid variable in one error', () => {
    const error = captureError(() => loadXmppConfig({}));
    expect(error.message).toContain('EJABBERD_ADMIN_JID');
    expect(error.message).toContain('EJABBERD_ADMIN_PASSWORD');
    expect(error.message).toContain('ZILAR_XMPP_JWT_SECRET');
  });

  it('rejects a short secret without putting the secret in the message', () => {
    const secret = 's3cr3t-but-far-too-short';
    const error = captureError(() =>
      loadXmppConfig({ ...validEnv, ZILAR_XMPP_JWT_SECRET: secret }),
    );
    expect(error.message).toContain('ZILAR_XMPP_JWT_SECRET');
    expect(error.message).not.toContain(secret);
  });

  it('never prints the admin password in an error about another variable', () => {
    const error = captureError(() => loadXmppConfig({ ...validEnv, XMPP_DOMAIN: 'Not A Domain' }));
    expect(error.message).toContain('XMPP_DOMAIN');
    expect(error.message).not.toContain('admin-password');
  });
});
