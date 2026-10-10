// Web push (T-0119, T-0543, T-0895): the VAPID config, the registered devices,
// the preview setting and the test notification.
//
// `subscribe`, `updateSettings` and `test` declare NO payload on purpose. The
// server decodes their bodies by hand inside the handler, so each route keeps
// its exact step order (push enabled, then decode, then limiter) and its own
// error codes (`invalid_subscription`, `invalid_request`). Declaring a payload
// here would make the router decode first and change that order, so a client
// sends those three bodies itself and the contract only types the replies.

import { Schema } from 'effect';
import { HttpApiEndpoint, HttpApiGroup } from 'effect/http-api';
import { ChainDSchemaErrors } from './chain-d-middleware';
import { Session } from './middleware';

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

export const PushDevice = Schema.Struct({
  id: Schema.String,
  userAgent: Schema.NullOr(Schema.String),
  createdAt: Schema.String,
  lastUsedAt: Schema.NullOr(Schema.String),
  inactive: Schema.Boolean,
});

export type PushDevice = typeof PushDevice.Type;

export const PushDeviceList = Schema.Struct({ devices: Schema.Array(PushDevice) });

export const PushRemoved = Schema.Struct({ removed: Schema.Boolean });

export const PushSettings = Schema.Struct({ showPreviews: Schema.Boolean });

export type PushSettings = typeof PushSettings.Type;

export const PushTestResult = Schema.Struct({ sent: Schema.Boolean });

export const PushGroup = HttpApiGroup.make('push')
  .add(
    HttpApiEndpoint.get('config', '/push/config', {
      success: PushConfig,
    }),
    HttpApiEndpoint.post('subscribe', '/push/subscriptions', {
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
    HttpApiEndpoint.put('updateSettings', '/push/settings', {
      success: PushSettings,
    }),
    HttpApiEndpoint.post('test', '/push/test', {
      success: PushTestResult,
    }),
  )
  .middleware(Session)
  .middleware(ChainDSchemaErrors)
  // The edge forwards the full request path, so the group keeps the `/api` prefix.
  .prefix('/api');
