import { z } from 'zod';
import { SignJWT } from 'jose';
import { JidSchema, decodeOrThrow } from '@zilar/protocol';
import type { XmppConfig } from './config';

// JWT login: our server signs a short-lived HS256 token and the client sends it
// as the SASL PLAIN password. ejabberd verifies it with the same secret, read
// from the JWK file written by infra/ejabberd/jwt-entrypoint.sh.
export const MAX_TOKEN_TTL_SECONDS = 600;

const TtlSecondsSchema = z.number().int().positive().max(MAX_TOKEN_TTL_SECONDS);

export type XmppToken = {
  token: string;
  expiresAt: Date;
};

export async function issueXmppToken(
  config: XmppConfig,
  bareJid: string,
  ttlSeconds: number = 300,
): Promise<XmppToken> {
  const jid = decodeOrThrow(JidSchema)(bareJid);
  const domain = jid.slice(jid.indexOf('@') + 1);
  if (domain !== config.domain) {
    throw new Error(`JID "${jid}" is not on the XMPP domain "${config.domain}"`);
  }

  const ttl = TtlSecondsSchema.parse(ttlSeconds);
  const nowSeconds = Math.floor(Date.now() / 1000);
  const expSeconds = nowSeconds + ttl;

  const token = await new SignJWT({ jid })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setIssuedAt(nowSeconds)
    .setExpirationTime(expSeconds)
    .sign(new TextEncoder().encode(config.jwtSecret));

  return { token, expiresAt: new Date(expSeconds * 1000) };
}
