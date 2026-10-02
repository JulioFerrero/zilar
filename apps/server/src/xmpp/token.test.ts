import { describe, expect, it } from 'vitest';
import { jwtVerify } from 'jose';
import { issueXmppToken, MAX_TOKEN_TTL_SECONDS } from './token';
import type { XmppConfig } from './config';

const config: XmppConfig = {
  apiUrl: 'http://ejabberd.test/api',
  adminJid: 'admin@zilar.localhost',
  adminPassword: 'admin-secret-value',
  domain: 'zilar.localhost',
  mucDomain: 'rooms.zilar.localhost',
  wsPublicUrl: 'ws://ejabberd.test:5280/ws',
  jwtSecret: 'shared-secret-that-is-long-enough-1234',
};

function secretBytes(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}

function secondsFromNow(): number {
  return Math.floor(Date.now() / 1000);
}

describe('issueXmppToken', () => {
  it('signs an HS256 token that verifies with the same secret', async () => {
    const { token, expiresAt } = await issueXmppToken(config, 'alice@zilar.localhost', 120);

    const { payload, protectedHeader } = await jwtVerify(token, secretBytes(config.jwtSecret));
    expect(protectedHeader.alg).toBe('HS256');
    expect(payload.jid).toBe('alice@zilar.localhost');

    const exp = payload.exp;
    expect(typeof exp).toBe('number');
    if (exp === undefined) {
      throw new Error('token has no exp claim');
    }
    const remaining = exp - secondsFromNow();
    expect(remaining).toBeGreaterThan(0);
    expect(remaining).toBeLessThanOrEqual(120);
    expect(Math.floor(expiresAt.getTime() / 1000)).toBe(exp);
  });

  it('defaults to a 5 minute lifetime', async () => {
    const { token } = await issueXmppToken(config, 'alice@zilar.localhost');
    const { payload } = await jwtVerify(token, secretBytes(config.jwtSecret));
    expect(payload.exp).toBeDefined();
    expect((payload.exp as number) - secondsFromNow()).toBeLessThanOrEqual(300);
  });

  it('rejects a JID that is not on the configured domain', async () => {
    await expect(issueXmppToken(config, 'alice@other.localhost')).rejects.toThrow(
      'not on the XMPP domain',
    );
  });

  it('rejects a JID that is not a bare JID', async () => {
    await expect(issueXmppToken(config, 'alice')).rejects.toThrow();
  });

  it('rejects a lifetime beyond the maximum', async () => {
    await expect(
      issueXmppToken(config, 'alice@zilar.localhost', MAX_TOKEN_TTL_SECONDS + 1),
    ).rejects.toThrow();
  });

  it('does not verify with a different secret', async () => {
    const { token } = await issueXmppToken(config, 'alice@zilar.localhost');
    await expect(
      jwtVerify(token, secretBytes('a-completely-different-secret-1234567')),
    ).rejects.toThrow();
  });
});
