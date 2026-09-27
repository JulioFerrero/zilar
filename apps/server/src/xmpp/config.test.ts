import { describe, expect, it } from 'vitest';
import { loadXmppConfig } from './config';

const validEnv = {
  EJABBERD_API_URL: 'http://127.0.0.1:5280/api',
  EJABBERD_ADMIN_JID: 'admin@galena.localhost',
  EJABBERD_ADMIN_PASSWORD: 'admin-password',
  XMPP_DOMAIN: 'galena.localhost',
  XMPP_MUC_DOMAIN: 'rooms.galena.localhost',
  GALENA_XMPP_JWT_SECRET: 'a'.repeat(40),
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
      adminJid: 'admin@galena.localhost',
      adminPassword: 'admin-password',
      domain: 'galena.localhost',
      mucDomain: 'rooms.galena.localhost',
      jwtSecret: 'a'.repeat(40),
    });
  });

  it('applies the default URL and domains', () => {
    const config = loadXmppConfig({
      EJABBERD_ADMIN_JID: 'admin@galena.localhost',
      EJABBERD_ADMIN_PASSWORD: 'admin-password',
      GALENA_XMPP_JWT_SECRET: 'b'.repeat(40),
    });
    expect(config.apiUrl).toBe('http://127.0.0.1:5280/api');
    expect(config.domain).toBe('galena.localhost');
    expect(config.mucDomain).toBe('rooms.galena.localhost');
  });

  it('strips trailing slashes from the API URL', () => {
    const config = loadXmppConfig({ ...validEnv, EJABBERD_API_URL: 'http://host:5280/api///' });
    expect(config.apiUrl).toBe('http://host:5280/api');
  });

  it('lists every missing or invalid variable in one error', () => {
    const error = captureError(() => loadXmppConfig({}));
    expect(error.message).toContain('EJABBERD_ADMIN_JID');
    expect(error.message).toContain('EJABBERD_ADMIN_PASSWORD');
    expect(error.message).toContain('GALENA_XMPP_JWT_SECRET');
  });

  it('rejects a short secret without putting the secret in the message', () => {
    const secret = 's3cr3t-but-far-too-short';
    const error = captureError(() =>
      loadXmppConfig({ ...validEnv, GALENA_XMPP_JWT_SECRET: secret }),
    );
    expect(error.message).toContain('GALENA_XMPP_JWT_SECRET');
    expect(error.message).not.toContain(secret);
  });

  it('never prints the admin password in an error about another variable', () => {
    const error = captureError(() => loadXmppConfig({ ...validEnv, XMPP_DOMAIN: 'Not A Domain' }));
    expect(error.message).toContain('XMPP_DOMAIN');
    expect(error.message).not.toContain('admin-password');
  });
});
