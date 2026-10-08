import { Schema } from 'effect';
import { isUrl, struct } from '@zilar/protocol';

// zod `z.url()` accepts any scheme, so the filter accepts any parseable URL.
const GifUrlSchema = Schema.String.pipe(
  Schema.check(
    Schema.isMaxLength(2048),
    Schema.makeFilter((value) => (isUrl(value) ? undefined : 'must be a URL')),
  ),
);

const GifDimensionSchema = Schema.Number.pipe(
  Schema.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(1), Schema.isLessThanOrEqualTo(20000)),
);

const GifSizeSchema = Schema.Number.pipe(
  Schema.check(
    Schema.isInt(),
    Schema.isGreaterThanOrEqualTo(0),
    Schema.isLessThanOrEqualTo(100 * 1024 * 1024),
  ),
);

/**
 * One GIF result: only the fields the UI needs. Provider-specific junk is
 * dropped when the adapter parses the provider response through this schema.
 */
export const gifItemSchema = struct({
  id: Schema.String.pipe(Schema.check(Schema.isMinLength(1), Schema.isMaxLength(128))),
  title: Schema.String.pipe(Schema.check(Schema.isMaxLength(100))),
  previewUrl: GifUrlSchema,
  mp4Url: Schema.optional(GifUrlSchema),
  gifUrl: Schema.optional(GifUrlSchema),
  width: GifDimensionSchema,
  height: GifDimensionSchema,
  sizeBytes: Schema.optional(GifSizeSchema),
});

export type GifItem = typeof gifItemSchema.Type;

export const gifPageSchema = struct({
  items: Schema.mutable(Schema.Array(gifItemSchema)),
  /** The `pos` value to pass for the next page, when there is one. */
  nextPos: Schema.optional(Schema.String.pipe(Schema.check(Schema.isMaxLength(128)))),
});

export type GifPage = typeof gifPageSchema.Type;

export interface GifSearchOptions {
  limit: number;
  pos?: string | undefined;
}

/** The port every GIF provider adapter implements. Tests use `fake`. */
export interface GifProvider {
  readonly name: string;
  search(query: string, options: GifSearchOptions): Promise<GifPage>;
  trending(options: GifSearchOptions): Promise<GifPage>;
}
