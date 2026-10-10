// GIF search, trending and the media proxy (T-0122, T-0586, T-0895). Every
// media URL arrives as an opaque `mediaToken` minted for the caller; previews
// and the send path load through the same-origin proxy
// (`/api/gifs/media/:token`).
//
// `search` and `trending` declare NO query on purpose. The server decodes the
// query by hand inside the handler, because the provider check and the limiter
// must run before the decode (an invalid query still spends budget; the order
// is session, 501, limiter, 400). A declared query would be decoded by the
// router first and change that order, so a client builds the query string
// itself and the contract only types the reply. `media` answers raw bytes with
// custom headers, so it declares no success.

import { Schema } from 'effect';
import { HttpApiEndpoint, HttpApiGroup } from 'effect/http-api';
import { ChainDSchemaErrors } from './chain-d-middleware';
import { Session } from './middleware';

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
  items: Schema.Array(GifResult),
  nextPos: Schema.optional(Schema.String),
});

export type GifResultPage = typeof GifResultPage.Type;

export const GifsGroup = HttpApiGroup.make('gifs')
  .add(
    HttpApiEndpoint.get('search', '/gifs/search', {
      success: GifResultPage,
    }),
    HttpApiEndpoint.get('trending', '/gifs/trending', {
      success: GifResultPage,
    }),
    // The token is verified inside the handler so a bad token answers 404
    // `not_found`, never a 400.
    HttpApiEndpoint.get('media', '/gifs/media/:token', {
      params: { token: Schema.String },
    }),
  )
  .middleware(Session)
  .middleware(ChainDSchemaErrors)
  // The edge forwards the full request path, so the group keeps the `/api` prefix.
  .prefix('/api');
