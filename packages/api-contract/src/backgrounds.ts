// Chat background images (T-0464, T-0577, T-0895): a user's personal
// wallpapers. The image bytes travel outside the derived client:
//
// - `upload` declares no payload. The handler reads the raw body stream under
//   a size cap, so a client posts the bytes itself and the contract only
//   types the 201 reply.
// - `getFile` answers the raw bytes with the stored mime type, so its success
//   is declared empty.

import { Schema } from 'effect';
import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema } from 'effect/http-api';
import { BackgroundsUploadRateLimit, SchemaErrors, Session } from './middleware';

/** The upload result. */
export const BackgroundImage = Schema.Struct({
  id: Schema.String,
  url: Schema.String,
  width: Schema.Number,
  height: Schema.Number,
});

export type BackgroundImage = typeof BackgroundImage.Type;

/** One listed image; the size is null for a row stored before sizes were kept. */
export const BackgroundListItem = Schema.Struct({
  id: Schema.String,
  url: Schema.String,
  width: Schema.NullOr(Schema.Number),
  height: Schema.NullOr(Schema.Number),
  createdAt: Schema.String,
});

export type BackgroundListItem = typeof BackgroundListItem.Type;

export const BackgroundList = Schema.Struct({ backgrounds: Schema.Array(BackgroundListItem) });

export const BackgroundsGroup = HttpApiGroup.make('backgrounds')
  .add(
    HttpApiEndpoint.post('upload', '/backgrounds', {
      success: BackgroundImage.pipe(HttpApiSchema.status(201)),
    }).middleware(BackgroundsUploadRateLimit),
    HttpApiEndpoint.get('list', '/backgrounds', {
      success: BackgroundList,
    }),
    HttpApiEndpoint.get('getFile', '/backgrounds/:id', {
      params: { id: Schema.String },
      success: HttpApiSchema.Empty(200),
    }),
    HttpApiEndpoint.delete('remove', '/backgrounds/:id', {
      params: { id: Schema.String },
      success: HttpApiSchema.NoContent,
    }),
  )
  .middleware(Session)
  .middleware(SchemaErrors)
  // The edge forwards the full request path, so the group keeps the `/api` prefix.
  .prefix('/api');
