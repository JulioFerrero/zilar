import { createHmac, timingSafeEqual } from 'node:crypto';
import { Exit, Schema } from 'effect';
import { struct } from '@zilar/protocol';

export const GIF_TOKEN_TTL_MS = 15 * 60 * 1000;

const tokenPayloadSchema = struct({
  u: Schema.String.pipe(Schema.check(Schema.isMinLength(1), Schema.isMaxLength(128))),
  m: Schema.String.pipe(Schema.check(Schema.isMinLength(1), Schema.isMaxLength(2048))),
  e: Schema.Number.pipe(Schema.check(Schema.isInt(), Schema.isGreaterThan(0))),
});

/**
 * Opaque media tokens (T-0122): HMAC-signed, expiring after 15 minutes, and
 * bound to the exact provider URL plus the user id. A token minted for user
 * A fails for user B, and any edit fails the signature.
 */
export interface GifTokenIssuer {
  issue(userId: string, mediaUrl: string): string;
  verify(token: string, userId: string): string | undefined;
}

export function createGifTokenIssuer(options: {
  secret: string;
  now?: () => number;
}): GifTokenIssuer {
  const now = options.now ?? Date.now;
  const secret = options.secret;

  return {
    issue(userId: string, mediaUrl: string): string {
      const payload = JSON.stringify({ u: userId, m: mediaUrl, e: now() + GIF_TOKEN_TTL_MS });
      const signature = createHmac('sha256', secret).update(payload).digest('base64url');
      return `${Buffer.from(payload, 'utf8').toString('base64url')}.${signature}`;
    },

    verify(token: string, userId: string): string | undefined {
      const dot = token.indexOf('.');
      if (dot <= 0) {
        return undefined;
      }
      const encoded = token.slice(0, dot);
      const signature = token.slice(dot + 1);
      let payload: string;
      try {
        payload = Buffer.from(encoded, 'base64url').toString('utf8');
      } catch {
        return undefined;
      }
      const expected = createHmac('sha256', secret).update(payload).digest('base64url');
      const left = Buffer.from(signature);
      const right = Buffer.from(expected);
      if (left.length !== right.length || !timingSafeEqual(left, right)) {
        return undefined;
      }
      const exit = Schema.decodeUnknownExit(tokenPayloadSchema)(JSON.parse(payload));
      if (!Exit.isSuccess(exit)) {
        return undefined;
      }
      if (exit.value.u !== userId) {
        return undefined;
      }
      if (exit.value.e <= now()) {
        return undefined;
      }
      return exit.value.m;
    },
  };
}
