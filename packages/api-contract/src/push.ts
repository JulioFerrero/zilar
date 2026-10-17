// Web push (T-0119, T-0543, T-0895): the VAPID config, the registered devices,
// the preview setting and the test notification.
//
// `subscribe`, `updateSettings` and `test` declare their payloads so the derived
// client is typed and encodes them, but the server serves the three with
// `handleRaw` and decodes the bodies by hand, so each route keeps its exact
// step order (push enabled, then decode, then limiter) and its own error codes
// (`invalid_subscription`, `invalid_request`).

import { Schema } from 'effect';
import { HttpApiEndpoint, HttpApiGroup } from 'effect/http-api';
import { SchemaErrors, Session } from './middleware';

export const PushConfig = Schema.Struct({
  vapidPublicKey: Schema.String.check(Schema.isMinLength(1)),
  pushJid: Schema.String.check(Schema.isMinLength(1)),
});

export type PushConfig = typeof PushConfig.Type;

export const RegisteredDevice = Schema.Struct({
  id: Schema.String.check(Schema.isMinLength(1)),
  node: Schema.String.check(Schema.isMinLength(1)),
  jid: Schema.String.check(Schema.isMinLength(1)),
});

export type RegisteredDevice = typeof RegisteredDevice.Type;

/** The transport a push device speaks: a browser, an Android app or an iPhone app. */
export const PushDeviceKind = Schema.Literals(['webpush', 'fcm', 'apns']);

export type PushDeviceKind = typeof PushDeviceKind.Type;

export const PushDevice = Schema.Struct({
  id: Schema.String,
  kind: PushDeviceKind,
  userAgent: Schema.NullOr(Schema.String),
  createdAt: Schema.String,
  lastUsedAt: Schema.NullOr(Schema.String),
  failedAt: Schema.NullOr(Schema.String),
  lastFailure: Schema.NullOr(Schema.String),
  inactive: Schema.Boolean,
});

export type PushDevice = typeof PushDevice.Type;

export const PushDeviceList = Schema.Struct({ devices: Schema.Array(PushDevice) });

export const PushRemoved = Schema.Struct({ removed: Schema.Boolean });

export const PushSettings = Schema.Struct({ showPreviews: Schema.Boolean });

export type PushSettings = typeof PushSettings.Type;

export const PushTestResult = Schema.Struct({ sent: Schema.Boolean });

/**
 * The notification text for one archived message, built by the server with the
 * same resolver and preview rules Web Push uses. Native clients fetch this from
 * the background task instead of opening an XMPP connection.
 */
export const PushPreview = Schema.Struct({
  title: Schema.String,
  body: Schema.String,
  chatId: Schema.String,
  // T-1893: the row's archive id, for a notification's Mark as read. Optional,
  // so new phones still read older servers.
  archiveId: Schema.optional(Schema.String),
  // T-1897: the chat's unread count, so a phone shows one notification per
  // chat with its badge. Optional, so new phones still read older servers.
  unread: Schema.optional(Schema.Number),
});

export type PushPreview = typeof PushPreview.Type;

/** The preview query: the archive origin id of one message. */
export const PushPreviewQuery = Schema.Struct({
  messageId: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(256)),
});

function isUrl(value: string): boolean {
  try {
    new URL(value);
    return true;
  } catch {
    return false;
  }
}

const PushKeys = Schema.Struct({
  p256dh: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(256)),
  auth: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(256)),
});

/**
 * The browser's `PushSubscription` JSON plus an optional device label. The
 * server decodes it by hand (strict is not applied: extra keys are ignored).
 */
export const RegisterPushDevicePayload = Schema.Struct({
  endpoint: Schema.String.check(
    Schema.isMaxLength(2048),
    Schema.makeFilter((value) => (isUrl(value) ? undefined : 'must be a URL')),
  ),
  expirationTime: Schema.optional(Schema.NullOr(Schema.Number)),
  keys: PushKeys,
  userAgent: Schema.optional(
    Schema.NullOr(Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(256))),
  ),
});

export type RegisterPushDevicePayload = typeof RegisterPushDevicePayload.Type;

/**
 * A native (FCM) registration: an app install's device token plus an optional
 * label. Only `fcm` is accepted for now; `apns` comes later. The server decodes
 * it by hand (extra keys are ignored) and never logs the token.
 */
export const RegisterNativePushDevicePayload = Schema.Struct({
  kind: Schema.Literal('fcm'),
  token: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(4096)),
  userAgent: Schema.optional(
    Schema.NullOr(Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(256))),
  ),
});

export type RegisterNativePushDevicePayload = typeof RegisterNativePushDevicePayload.Type;

/**
 * The subscribe body: the Web Push `PushSubscription` JSON (no `kind`, so the
 * web client is unchanged) or a native `{ kind: 'fcm', token }`. An unknown
 * `kind` or an empty token matches neither member and is a 400.
 */
export const SubscribePushDevicePayload = Schema.Union([
  RegisterPushDevicePayload,
  RegisterNativePushDevicePayload,
]);

export type SubscribePushDevicePayload = typeof SubscribePushDevicePayload.Type;

/** Strict when decoded by the server: an excess key is a 400. */
export const PushSettingsPayload = Schema.Struct({ showPreviews: Schema.Boolean });

/** Strict when decoded by the server: an excess key is a 400. */
export const PushTestPayload = Schema.Struct({
  subscriptionId: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(256)),
});

export const PushGroup = HttpApiGroup.make('push')
  .add(
    HttpApiEndpoint.get('config', '/push/config', {
      success: PushConfig,
    }),
    HttpApiEndpoint.post('subscribe', '/push/subscriptions', {
      payload: SubscribePushDevicePayload,
      success: RegisteredDevice,
    }),
    HttpApiEndpoint.get('list', '/push/subscriptions', {
      success: PushDeviceList,
    }),
    HttpApiEndpoint.delete('remove', '/push/subscriptions/:id', {
      params: { id: Schema.String },
      success: PushRemoved,
    }),
    HttpApiEndpoint.get('settings', '/push/settings', {
      success: PushSettings,
    }),
    HttpApiEndpoint.get('preview', '/push/preview', {
      query: PushPreviewQuery,
      success: PushPreview,
    }),
    HttpApiEndpoint.put('updateSettings', '/push/settings', {
      payload: PushSettingsPayload,
      success: PushSettings,
    }),
    HttpApiEndpoint.post('test', '/push/test', {
      payload: PushTestPayload,
      success: PushTestResult,
    }),
  )
  .middleware(Session)
  .middleware(SchemaErrors)
  // The edge forwards the full request path, so the group keeps the `/api` prefix.
  .prefix('/api');
