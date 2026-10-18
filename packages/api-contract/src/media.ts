// The query is decoded by hand so the archive check and limiter run before the decode (session, 501, 429, 400, 404).

import { Schema } from 'effect';
import { HttpApiEndpoint, HttpApiGroup } from 'effect/http-api';
import { lenientArray } from './lenient';
import { LenientNullableString } from './lenient-nullable-string';
import { SchemaErrors, Session } from './middleware';
import { RawQueryValue } from './raw-query';

export const MEDIA_TABS = ['media', 'files', 'links', 'voice'] as const;

export type MediaTab = (typeof MEDIA_TABS)[number];

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

// `next` is the paging cursor (microseconds as a string).
export const MediaPage = Schema.Struct({
  items: lenientArray(MediaItem),
  next: LenientNullableString,
});

export type MediaPage = typeof MediaPage.Type;

export const MediaGroup = HttpApiGroup.make('media')
  .add(
    HttpApiEndpoint.get('gallery', '/media', {
      query: {
        chat: RawQueryValue,
        type: RawQueryValue,
        before: RawQueryValue,
        limit: RawQueryValue,
      },
      success: MediaPage,
    }),
  )
  .middleware(Session)
  .middleware(SchemaErrors)
  // The edge forwards the full request path, so the group keeps the `/api` prefix.
  .prefix('/api');
