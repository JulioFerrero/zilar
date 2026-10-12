// T-1234: a small unfurl of a pasted link. The server fetches the page
// through the sandbox guard and reads its head metadata; a page with no title
// and no description answers 204 (nothing to show), so the endpoint declares
// two success statuses.

import { Schema } from 'effect';
import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema } from 'effect/http-api';
import { SchemaErrors, Session } from './middleware';
import { RawQueryValue } from './raw-query';

/** The unfurled head of a page. Every field is absent when the page has none. */
export const LinkPreview = Schema.Struct({
  title: Schema.optional(Schema.String),
  description: Schema.optional(Schema.String),
  siteName: Schema.optional(Schema.String),
  // T-1252: the server path of the preview image (`/api/link-preview/image/…`),
  // never the remote URL.
  image: Schema.optional(Schema.String),
});

export type LinkPreview = typeof LinkPreview.Type;

export const LinkPreviewGroup = HttpApiGroup.make('linkPreview')
  .add(
    HttpApiEndpoint.get('get', '/link-preview', {
      // `url` is decoded by hand in the handler (the contract declares it as
      // `RawQueryValue`), so a missing, non-https or overlong URL is the
      // handler's fixed 400, after the rate limit.
      query: { url: RawQueryValue },
      success: [LinkPreview, HttpApiSchema.NoContent],
    }),
    // T-1252: the preview image, served only through the server. The handler
    // returns the raw bytes with custom headers, so the success is declared
    // empty (the same shape as the backgrounds `getFile` and stickers
    // `serveFile` routes). An unknown or expired key is the handler's 404.
    HttpApiEndpoint.get('image', '/link-preview/image/:key', {
      params: { key: Schema.String },
      success: HttpApiSchema.Empty(200),
    }),
  )
  .middleware(Session)
  .middleware(SchemaErrors)
  // The edge forwards the full request path, so the group keeps the `/api` prefix.
  .prefix('/api');
