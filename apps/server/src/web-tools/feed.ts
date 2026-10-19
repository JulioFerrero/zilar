// effect-plain: pure RSS/Atom parse; malformed input is a result value, not an error
// A small hand-written RSS/Atom reader, no dependency. A body containing
// `<!DOCTYPE` or `<!ENTITY` is rejected before parsing, so no external entity
// can be fetched.
import { elementBlocks, firstElement, nextOpenTag, openTagAttrs, stripTags } from '../markup/scan';
import { decodeNamedEntity } from './search';

export interface FeedItem {
  title: string;
  link: string;
  date: string;
  snippet: string;
}

const MAX_FEED_INPUT_CHARS = 2 * 1024 * 1024;
const MAX_FEED_ITEMS = 20;
export const MAX_SNIPPET_CHARS = 300;

export type FeedParseResult = { ok: true; items: FeedItem[] } | { ok: false; summary: string };

export function parseFeed(body: string): FeedParseResult {
  if (/<!DOCTYPE/i.test(body) || /<!ENTITY/i.test(body)) {
    return { ok: false, summary: 'feed with DTD or entities is not allowed' };
  }
  const input = body.length > MAX_FEED_INPUT_CHARS ? body.slice(0, MAX_FEED_INPUT_CHARS) : body;
  const items =
    /<feed[\s>]/i.test(input) && !/<rss[\s>]/i.test(input.split('<feed')[0] ?? '')
      ? readAtomItems(input)
      : readRssItems(input);
  if (items.length === 0) {
    return { ok: false, summary: 'no feed items found' };
  }
  return { ok: true, items: items.slice(0, MAX_FEED_ITEMS) };
}

function readRssItems(input: string): FeedItem[] {
  const blocks = elementBlocks(input, 'item', MAX_FEED_ITEMS);
  return blocks.map((block) => ({
    title: firstText(block, ['title']),
    link: firstText(block, ['link']),
    date: firstText(block, ['pubDate', 'dc:date', 'updated', 'published']),
    snippet: snippetOf(firstText(block, ['description', 'content:encoded', 'summary'])),
  }));
}

function readAtomItems(input: string): FeedItem[] {
  const blocks = elementBlocks(input, 'entry', MAX_FEED_ITEMS);
  return blocks.map((block) => ({
    title: firstText(block, ['title']),
    link: atomLink(block) ?? firstText(block, ['link']),
    date: firstText(block, ['updated', 'published']),
    snippet: snippetOf(firstText(block, ['summary', 'content'])),
  }));
}

// `<link href="…"/>` wins over bare link text; only http(s) targets are kept.
function atomLink(block: string): string | null {
  let cursor = 0;
  while (true) {
    const link = nextOpenTag(block, 'link', cursor);
    if (link === null) {
      return null;
    }
    const href = attrOf(link.attrs, 'href')?.trim();
    if (href !== null && href !== undefined) {
      return /^https?:\/\//i.test(href) ? href : null;
    }
    cursor = link.end;
  }
}

function firstText(block: string, tags: string[]): string {
  for (const tag of tags) {
    const element = firstElement(block, tag);
    if (element !== null) {
      const text = plainText(element.inner);
      if (text.length > 0) {
        return text;
      }
    }
    if (tag.toLowerCase() === 'content') {
      const attrs = openTagAttrs(block, tag);
      const selfClosed = attrs !== null && attrs.trimEnd().endsWith('/');
      const src = selfClosed ? attrOf(attrs, 'src') : null;
      if (src !== null && src.length > 0) {
        return src;
      }
    }
  }
  return '';
}

function attrOf(attrs: string, name: string): string | null {
  const match = new RegExp(`\\b${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i').exec(attrs);
  if (match === null) {
    return null;
  }
  return match[2] ?? match[3] ?? match[4] ?? null;
}

// CDATA first, then strip tags, decode entities and collapse whitespace.
function plainText(value: string): string {
  const cdata = /^<!\[CDATA\[([\s\S]*)\]\]>$/.exec(value.trim());
  const inner = cdata !== null && cdata[1] !== undefined ? cdata[1] : value;
  return stripTags(inner, ' ')
    .replace(/&(#\d+|#x[0-9a-fA-F]+|amp|lt|gt|quot|apos|nbsp);/g, (full, body: string) => {
      const named = decodeNamedEntity(body);
      if (named !== undefined) {
        return named;
      }
      const code =
        body.startsWith('#x') || body.startsWith('#X')
          ? Number.parseInt(body.slice(2), 16)
          : Number.parseInt(body.slice(1), 10);
      if (Number.isInteger(code) && code >= 0 && code <= 0x10ffff) {
        try {
          return String.fromCodePoint(code);
        } catch {
          return full;
        }
      }
      return full;
    })
    .replace(/\s+/g, ' ')
    .trim();
}

function snippetOf(text: string): string {
  if (text.length <= MAX_SNIPPET_CHARS) {
    return text;
  }
  return `${text.slice(0, MAX_SNIPPET_CHARS)}…`;
}
