// The image bytes travel outside the derived client: `upload` reads the raw body under a size cap,
// and `getFile` answers the raw bytes, so neither declares a payload or a JSON success.

import { Schema } from 'effect';
import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema } from 'effect/http-api';
import { BackgroundsUploadRateLimit, SchemaErrors, Session } from './middleware';

export const BackgroundImage = Schema.Struct({
  id: Schema.String,
  url: Schema.String,
  width: Schema.Number,
  height: Schema.Number,
});

export type BackgroundImage = typeof BackgroundImage.Type;

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
