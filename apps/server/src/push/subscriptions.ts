import { Schema } from 'effect';
import { isUrl, struct } from '@zilar/protocol';

// The browser's PushSubscription JSON (Web Push API), validated at the route
// boundary before anything is stored.
export const WebPushKeysSchema = struct({
  p256dh: Schema.String.pipe(Schema.check(Schema.isMinLength(1), Schema.isMaxLength(256))),
  auth: Schema.String.pipe(Schema.check(Schema.isMinLength(1), Schema.isMaxLength(256))),
});

// zod's `z.url()` accepted any scheme, so the filter accepts any parseable URL.
export const WebPushSubscriptionSchema = struct({
  endpoint: Schema.String.pipe(
    Schema.check(
      Schema.isMaxLength(2048),
      Schema.makeFilter((value) => (isUrl(value) ? undefined : 'must be a URL')),
    ),
  ),
  expirationTime: Schema.optional(Schema.NullOr(Schema.Number)),
  keys: WebPushKeysSchema,
});

export type WebPushSubscription = Schema.Schema.Type<typeof WebPushSubscriptionSchema>;
