import { z } from 'zod';

/**
 * One GIF result: only the fields the UI needs. Provider-specific junk is
 * dropped when the adapter parses the provider response through this schema.
 */
export const gifItemSchema = z.object({
  id: z.string().min(1).max(128),
  title: z.string().max(100),
  previewUrl: z.url().max(2048),
  mp4Url: z.url().max(2048).optional(),
  gifUrl: z.url().max(2048).optional(),
  width: z.number().int().min(1).max(20000),
  height: z.number().int().min(1).max(20000),
  sizeBytes: z
    .number()
    .int()
    .min(0)
    .max(100 * 1024 * 1024)
    .optional(),
});

export type GifItem = z.infer<typeof gifItemSchema>;

export const gifPageSchema = z.object({
  items: z.array(gifItemSchema),
  /** The `pos` value to pass for the next page, when there is one. */
  nextPos: z.string().max(128).optional(),
});

export type GifPage = z.infer<typeof gifPageSchema>;

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
