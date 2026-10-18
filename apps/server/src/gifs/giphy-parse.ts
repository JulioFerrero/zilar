import { Exit, Schema } from 'effect';
import { struct } from '@zilar/protocol';
import type { GifPage } from './provider';
import { gifItemSchema } from './provider';

// Giphy media hosts from the public docs. The API endpoint host is allowed too, because a
// hostile response could smuggle it in; every URL in an item re-checks this allowlist.
export const GIPHY_MEDIA_HOSTS = [
  'media0.giphy.com',
  'media1.giphy.com',
  'media2.giphy.com',
  'media3.giphy.com',
  'media4.giphy.com',
  'media.giphy.com',
  'i.giphy.com',
  'api.giphy.com',
] as const;

const passthrough = [Schema.Record(Schema.String, Schema.Unknown)] as const;

const renditionSchema = Schema.StructWithRest(
  struct({
    url: Schema.optional(Schema.String),
    mp4: Schema.optional(Schema.String),
    webp: Schema.optional(Schema.String),
    width: Schema.optional(Schema.String),
    height: Schema.optional(Schema.String),
    size: Schema.optional(Schema.String),
    mp4_size: Schema.optional(Schema.String),
    webp_size: Schema.optional(Schema.String),
  }),
  passthrough,
);

const gifObjectSchema = Schema.StructWithRest(
  struct({
    id: Schema.optional(Schema.String),
    title: Schema.optional(Schema.String),
    images: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)),
  }),
  passthrough,
);

const giphyResponseSchema = Schema.StructWithRest(
  struct({
    data: Schema.Array(Schema.Unknown),
    pagination: Schema.optional(
      Schema.StructWithRest(
        struct({
          offset: Schema.optional(Schema.Number),
          count: Schema.optional(Schema.Number),
          total_count: Schema.optional(Schema.Number),
        }),
        passthrough,
      ),
    ),
  }),
  passthrough,
);

function decodeRendition(value: unknown): typeof renditionSchema.Type | undefined {
  const decoded = Schema.decodeUnknownExit(renditionSchema)(value);
  return Exit.isSuccess(decoded) ? decoded.value : undefined;
}

function positiveInt(value: string | undefined): number | undefined {
  if (value === undefined || value === '') {
    return undefined;
  }
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}

function httpsOnAllowlist(url: string): URL | undefined {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return undefined;
  }
  if (parsed.protocol !== 'https:') {
    return undefined;
  }
  const host = parsed.hostname.toLowerCase();
  if (!(GIPHY_MEDIA_HOSTS as readonly string[]).includes(host)) {
    return undefined;
  }
  return parsed;
}

// One playable rendition per GIF object (fixed-width mp4, then gif/webp, then the
// original). Anything off the media allowlist drops the whole item.
function toItem(raw: unknown): GifPage['items'][number] | undefined {
  const parsed = Schema.decodeUnknownExit(gifObjectSchema)(raw);
  if (!Exit.isSuccess(parsed)) {
    return undefined;
  }
  const images = parsed.value.images ?? {};
  const candidates = [
    decodeRendition(images['fixed_width']),
    decodeRendition(images['downsized']),
    decodeRendition(images['downsized_small']),
    decodeRendition(images['original']),
  ];
  for (const candidate of candidates) {
    if (candidate === undefined) {
      continue;
    }
    const mp4 = candidate.mp4 !== undefined ? httpsOnAllowlist(candidate.mp4) : undefined;
    const url =
      candidate.url !== undefined
        ? httpsOnAllowlist(candidate.url)
        : candidate.webp !== undefined
          ? httpsOnAllowlist(candidate.webp)
          : undefined;
    if (url === undefined) {
      continue;
    }
    const width = positiveInt(candidate.width) ?? 200;
    const height = positiveInt(candidate.height) ?? 200;
    const size =
      positiveInt(candidate.mp4_size) ??
      positiveInt(candidate.size) ??
      positiveInt(candidate.webp_size);
    const item = {
      id: typeof parsed.value.id === 'string' ? parsed.value.id.slice(0, 128) : 'unknown',
      title: (typeof parsed.value.title === 'string' ? parsed.value.title : '').slice(0, 100),
      previewUrl: url.toString(),
      ...(mp4 === undefined ? {} : { mp4Url: mp4.toString() }),
      gifUrl: url.toString(),
      width,
      height,
      ...(size === undefined ? {} : { sizeBytes: size }),
    };
    const validated = Schema.decodeUnknownExit(gifItemSchema)(item);
    if (Exit.isSuccess(validated)) {
      return validated.value;
    }
  }
  return undefined;
}

export function parseGiphyResponse(body: unknown): GifPage {
  const parsed = Schema.decodeUnknownExit(giphyResponseSchema)(body);
  if (!Exit.isSuccess(parsed)) {
    return { items: [] };
  }
  const items: GifPage['items'] = [];
  for (const raw of parsed.value.data) {
    const item = toItem(raw);
    if (item !== undefined) {
      items.push(item);
    }
  }
  const pagination = parsed.value.pagination;
  const offset = pagination?.offset ?? 0;
  const count = pagination?.count ?? items.length;
  const total = pagination?.total_count ?? offset + count;
  const next = offset + count < total ? String(offset + count) : undefined;
  return { items, ...(next === undefined ? {} : { nextPos: next }) };
}
