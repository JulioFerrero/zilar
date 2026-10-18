// T-1234: read the head metadata a link preview shows. Pure, no I/O.
// effect-plain: pure head-metadata parsing; malformed input yields null, no I/O
//
// The shared `apps/server/src/web-tools/html.ts` extractor strips the head
// (it turns a body into plain text), so this module reads the
// `<meta>`/`<title>` tags directly and decodes attribute values with the
// shared entity decoder.
import { decodeHtmlEntities } from '../markup/entities';
import { firstElement, nextOpenTag, stripComments } from '../markup/scan';

const MAX_INPUT_CHARS = 256 * 1024;
const MAX_TITLE_CHARS = 200;
const MAX_DESCRIPTION_CHARS = 300;
const MAX_IMAGE_CHARS = 2000;

/** The unfurled head of a page; every field is absent when the page has none. */
export interface LinkPreviewData {
  title?: string;
  description?: string;
  siteName?: string;
  /**
   * T-1252: the resolved, https-only `og:image` (or `twitter:image`). It is
   * the remote URL; the server never sends it to a client — the fetcher swaps
   * it for a server path backed by its image cache.
   */
  imageUrl?: string;
}

/**
 * Reads `og:title`/`og:description`/`og:site_name`, then
 * `twitter:title`/`twitter:description`, then `<title>` and
 * `<meta name="description">`. Decodes entities, trims, caps the title at 200
 * and the description at 300 characters. T-1252 adds `og:image` (then
 * `twitter:image`), resolved against `pageUrl` and kept only when it is
 * `https:` and at most 2,000 characters. Returns `null` when the page has
 * neither a title nor a description.
 */
export function parseLinkPreview(html: string, pageUrl?: string): LinkPreviewData | null {
  const input = html.length > MAX_INPUT_CHARS ? html.slice(0, MAX_INPUT_CHARS) : html;
  const withoutComments = stripComments(input);
  const meta = metaContent(withoutComments);
  const title = cap(
    pick(meta.get('og:title'), meta.get('twitter:title'), titleTagText(withoutComments)),
    MAX_TITLE_CHARS,
  );
  const description = cap(
    pick(meta.get('og:description'), meta.get('twitter:description'), meta.get('description')),
    MAX_DESCRIPTION_CHARS,
  );
  const siteName = pick(meta.get('og:site_name'));
  const imageUrl = resolveImageUrl(pick(meta.get('og:image'), meta.get('twitter:image')), pageUrl);
  if (title === undefined && description === undefined) {
    return null;
  }
  return {
    ...(title === undefined ? {} : { title }),
    ...(description === undefined ? {} : { description }),
    ...(siteName === undefined ? {} : { siteName }),
    ...(imageUrl === undefined ? {} : { imageUrl }),
  };
}

// T-1252: resolve the image candidate against the page URL and keep it only
// when the result is https (an `http:` or a scheme-relative image that lands
// on http is dropped), capped at 2,000 characters.
function resolveImageUrl(
  value: string | undefined,
  pageUrl: string | undefined,
): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  let resolved: string;
  try {
    resolved = pageUrl === undefined ? value : new URL(value, pageUrl).toString();
  } catch {
    return undefined;
  }
  if (!/^https:\/\//i.test(resolved)) {
    return undefined;
  }
  return cap(resolved, MAX_IMAGE_CHARS);
}

// The first non-empty value (entities decoded, whitespace collapsed). An
// empty tag never wins over a later fallback.
function pick(...values: Array<string | undefined>): string | undefined {
  for (const value of values) {
    const cleaned = value === undefined ? '' : cleanText(value);
    if (cleaned.length > 0) {
      return cleaned;
    }
  }
  return undefined;
}

function cleanText(value: string): string {
  return decodeHtmlEntities(value).replace(/\s+/g, ' ').trim();
}

function cap(value: string | undefined, max: number): string | undefined {
  if (value === undefined || value.length <= max) {
    return value;
  }
  return value.slice(0, max);
}

// Every `<meta>` tag's content, keyed by `property` (og:) or `name`
// (twitter:, description). The first tag for a key wins.
function metaContent(html: string): Map<string, string> {
  const found = new Map<string, string>();
  let cursor = 0;
  while (true) {
    const tag = nextOpenTag(html, 'meta', cursor);
    if (tag === null) {
      break;
    }
    const attributes = readAttributes(tag.attrs);
    const key = (attributes.get('property') ?? attributes.get('name') ?? '').trim().toLowerCase();
    const content = attributes.get('content');
    if (key.length > 0 && content !== undefined && !found.has(key)) {
      found.set(key, content);
    }
    cursor = tag.end;
  }
  return found;
}

function titleTagText(html: string): string | undefined {
  return firstElement(html, 'title')?.inner;
}

// Attribute order varies, so each tag is parsed into a name -> value map;
// quoted and unquoted values are both accepted.
function readAttributes(tag: string): Map<string, string> {
  const attributes = new Map<string, string>();
  const pattern = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*=\s*("([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/g;
  for (const match of tag.matchAll(pattern)) {
    const name = match[1]?.toLowerCase();
    if (name === undefined || attributes.has(name)) {
      continue;
    }
    attributes.set(name, match[3] ?? match[4] ?? match[5] ?? '');
  }
  return attributes;
}
