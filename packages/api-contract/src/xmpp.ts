// The XMPP credential (T-0533, moved to the contract by T-1111): one POST
// mints a short-lived websocket token for the caller's XMPP account,
// provisioning it first if needed.

import { Schema } from 'effect';
import { HttpApiEndpoint, HttpApiGroup } from 'effect/http-api';
import { Session, XmppTokenRateLimit } from './middleware';

export const XmppTokenResult = Schema.Struct({
  jid: Schema.String,
  token: Schema.String,
  expiresAt: Schema.String,
  service: Schema.String,
  domain: Schema.String,
  mucDomain: Schema.String,
});

export type XmppTokenResult = typeof XmppTokenResult.Type;

export const XmppGroup = HttpApiGroup.make('xmpp')
  .add(
    HttpApiEndpoint.post('token', '/xmpp/token', { success: XmppTokenResult }).middleware(
      XmppTokenRateLimit,
    ),
  )
  .middleware(Session)
  // The edge forwards the full request path, so the group keeps the `/api` prefix.
  .prefix('/api');
