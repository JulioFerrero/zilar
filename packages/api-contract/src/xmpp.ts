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
