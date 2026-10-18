// The three payload-writing routes are served with `handleRaw` so each keeps its step order (push enabled, decode, limiter) and its own error codes.

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

// Built by the server with the same resolver and preview rules Web Push uses; native clients fetch it instead of opening an XMPP connection.
export const PushPreview = Schema.Struct({
  title: Schema.String,
  body: Schema.String,
  chatId: Schema.String,
  archiveId: Schema.optional(Schema.String),
  unread: Schema.optional(Schema.Number),
});

export type PushPreview = typeof PushPreview.Type;

export const PushPreviewQuery = Schema.Struct({
  messageId: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(256)),
});

// A leading dot matches the host itself and any subdomain; every other entry must match exactly.
const PUSH_ENDPOINT_HOSTS = [
  'fcm.googleapis.com',
  'updates.push.services.mozilla.com',
  'push.services.mozilla.com',
  '.notify.windows.com',
  'web.push.apple.com',
  '.push.apple.com',
] as const;

// An internal address, a plain-http URL or a lookalike host is refused, so a registered endpoint can never turn the sender into a port scanner.
export function isAllowedPushEndpoint(value: string): boolean {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.protocol !== 'https:') {
    return false;
  }
  if (url.port !== '' && url.port !== '443') {
    return false;
  }
  const host = url.hostname.toLowerCase();
  return PUSH_ENDPOINT_HOSTS.some((entry) =>
    entry.startsWith('.') ? host === entry.slice(1) || host.endsWith(entry) : host === entry,
  );
}

const PushKeys = Schema.Struct({
  p256dh: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(256)),
  auth: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(256)),
});

export const RegisterPushDevicePayload = Schema.Struct({
  endpoint: Schema.String.check(
    Schema.isMaxLength(2048),
    Schema.makeFilter((value) =>
      isAllowedPushEndpoint(value) ? undefined : 'must be a Web Push service endpoint',
    ),
  ),
  expirationTime: Schema.optional(Schema.NullOr(Schema.Number)),
  keys: PushKeys,
  userAgent: Schema.optional(
    Schema.NullOr(Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(256))),
  ),
});

export type RegisterPushDevicePayload = typeof RegisterPushDevicePayload.Type;

// Only `fcm` is accepted for now; the server never logs the token.
export const RegisterNativePushDevicePayload = Schema.Struct({
  kind: Schema.Literal('fcm'),
  token: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(4096)),
  userAgent: Schema.optional(
    Schema.NullOr(Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(256))),
  ),
});

export type RegisterNativePushDevicePayload = typeof RegisterNativePushDevicePayload.Type;

export const SubscribePushDevicePayload = Schema.Union([
  RegisterPushDevicePayload,
  RegisterNativePushDevicePayload,
]);

export type SubscribePushDevicePayload = typeof SubscribePushDevicePayload.Type;

export const PushSettingsPayload = Schema.Struct({ showPreviews: Schema.Boolean });

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
