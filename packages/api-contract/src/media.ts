// The media gallery (T-0431, T-0434, T-0560, T-0895): the shared files, links,
// voice notes and images of one chat, newest first.
//
// `gallery` declares NO query on purpose. The server decodes the query by
// hand inside the handler, because the archive check and the limiter must run
// before the decode (an invalid query still spends budget; the order is
// session, 501, 429, 400, 404). A declared query would be decoded by the router
// first and change that order, so a client builds the query string itself and
// the contract only types the reply.

import { Schema } from 'effect';
import { HttpApiEndpoint, HttpApiGroup } from 'effect/http-api';
import { ChainDSchemaErrors } from './chain-d-middleware';
import { Session } from './middleware';

/** The gallery tabs a client can ask for (`type`). */
export const MEDIA_TABS = ['media', 'files', 'links', 'voice'] as const;

export type MediaTab = (typeof MEDIA_TABS)[number];

/**
 * One gallery row. Every optional field is absent, never `null`, when the
 * message has no such value.
 */
export const MediaItem = Schema.Struct({
  messageId: Schema.String,
  chat: Schema.String,
  at: Schema.String,
  senderName: Schema.String,
  kind: Schema.Literals(['image', 'file', 'gif', 'voice', 'link']),
  url: Schema.optional(Schema.String),
  name: Schema.optional(Schema.String),
  size: Schema.optional(Schema.Number),
  mime: Schema.optional(Schema.String),
  width: Schema.optional(Schema.Number),
  height: Schema.optional(Schema.Number),
  durationMs: Schema.optional(Schema.Number),
  waveform: Schema.optional(Schema.Array(Schema.Number)),
  linkUrl: Schema.optional(Schema.String),
  linkHost: Schema.optional(Schema.String),
});

export type MediaItem = typeof MediaItem.Type;

/** One page, newest first; `next` is the paging cursor (microseconds as a string). */
export const MediaPage = Schema.Struct({
  items: Schema.Array(MediaItem),
  next: Schema.NullOr(Schema.String),
});

export type MediaPage = typeof MediaPage.Type;

export const MediaGroup = HttpApiGroup.make('media')
  .add(
    HttpApiEndpoint.get('gallery', '/media', {
      success: MediaPage,
    }),
  )
  .middleware(Session)
  .middleware(ChainDSchemaErrors)
  // The edge forwards the full request path, so the group keeps the `/api` prefix.
  .prefix('/api');
