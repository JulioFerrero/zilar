// Every media URL arrives as an opaque `mediaToken` minted for the caller; previews and sends load through the same-origin proxy.
// The query is decoded by hand so the provider check and limiter run before the decode (session, 501, limiter, 400).

import { Schema } from 'effect';
import { HttpApiEndpoint, HttpApiGroup } from 'effect/http-api';
import { lenientArray, LenientOptionalString } from './lenient';
import { SchemaErrors, Session } from './middleware';
import { RawQueryValue } from './raw-query';

export const GifResult = Schema.Struct({
  id: Schema.String,
  title: Schema.String,
  mediaToken: Schema.String,
  kind: Schema.Literals(['image', 'video']),
  width: Schema.Number,
  height: Schema.Number,
  sizeBytes: Schema.optional(Schema.Number),
});

export type GifResult = typeof GifResult.Type;

export const GifResultPage = Schema.Struct({
  items: lenientArray(GifResult),
  nextPos: LenientOptionalString,
});

export type GifResultPage = typeof GifResultPage.Type;

export const GifsGroup = HttpApiGroup.make('gifs')
  .add(
    HttpApiEndpoint.get('search', '/gifs/search', {
      query: { q: RawQueryValue, pos: RawQueryValue },
      success: GifResultPage,
    }),
    HttpApiEndpoint.get('trending', '/gifs/trending', {
      query: { pos: RawQueryValue },
      success: GifResultPage,
    }),
    // The token is verified in the handler so a bad token answers 404 `not_found`, never a 400.
    HttpApiEndpoint.get('media', '/gifs/media/:token', {
      params: { token: Schema.String },
    }),
  )
  .middleware(Session)
  .middleware(SchemaErrors)
  // The edge forwards the full request path, so the group keeps the `/api` prefix.
  .prefix('/api');
