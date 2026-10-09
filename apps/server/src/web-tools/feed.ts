// T-0125: a small hand-written feed reader for RSS and Atom. No new
// dependency. DTDs and entities are refused: any body containing
// `<!DOCTYPE` or `<!ENTITY` is rejected before parsing, so no external
// entity can ever be fetched. Items come back newest-first as far as a
// tag scan can tell; the adapter caps counts and snippet lengths.
// effect-plain: pure RSS/Atom parse; malformed input is a result value, not an error
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
  const blocks = blocksOf(input, 'item');
  return blocks.map((block) => ({
    title: firstText(block, ['title']),
    link: firstText(block, ['link']),
    date: firstText(block, ['pubDate', 'dc:date', 'updated', 'published']),
    snippet: snippetOf(firstText(block, ['description', 'content:encoded', 'summary'])),
  }));
}

function readAtomItems(input: string): FeedItem[] {
  const blocks = blocksOf(input, 'entry');
  return blocks.map((block) => ({
    title: firstText(block, ['title']),
    link: atomLink(block) ?? firstText(block, ['link']),
    date: firstText(block, ['updated', 'published']),
    snippet: snippetOf(firstText(block, ['summary', 'content'])),
  }));
}

// The entry's alternate link: `<link href="…"/>` wins over a bare
// `<link>…</link>` text, and only http(s) targets are kept.
function atomLink(block: string): string | null {
  const withHref = /<link\b[^>]*\bhref\s*=\s*("([^"]*)"|'([^']*)')[^>]*\/?>/i.exec(block);
  if (withHref !== null) {
    const href = (withHref[2] ?? withHref[3] ?? '').trim();
    if (/^https?:\/\//i.test(href)) {
      return href;
    }
  }
  return null;
}

// Every `<tag>…</tag>` block in document order.
function blocksOf(input: string, tag: string): string[] {
  const pattern = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}\\s*>`, 'gi');
  const blocks: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(input)) !== null) {
    blocks.push(match[1] ?? '');
    if (blocks.length >= MAX_FEED_ITEMS) {
      break;
    }
  }
  return blocks;
}

function firstText(block: string, tags: string[]): string {
  for (const tag of tags) {
    const pattern = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}\\s*>`, 'i');
    const match = pattern.exec(block);
    if (match !== null && match[1] !== undefined) {
      const text = plainText(match[1]);
      if (text.length > 0) {
        return text;
      }
    }
    if (tag.toLowerCase() === 'content') {
      const selfClosed = new RegExp(`<${tag}\\b([^>]*)\\/\\s*>`, 'i').exec(block);
      const src = selfClosed?.[1] !== undefined ? attrOf(selfClosed[1], 'src') : null;
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

// CDATA first, then strip inner tags, decode the common entities and
// collapse whitespace.
function plainText(value: string): string {
  const cdata = /^<!\[CDATA\[([\s\S]*)\]\]>$/.exec(value.trim());
  const inner = cdata !== null && cdata[1] !== undefined ? cdata[1] : value;
  return inner
    .replace(/<[^>]*>/g, ' ')
    .replace(/&(#\d+|#x[0-9a-fA-F]+|amp|lt|gt|quot|apos|nbsp);/g, (full, body: string) => {
      switch (body) {
        case 'amp':
          return '&';
        case 'lt':
          return '<';
        case 'gt':
          return '>';
        case 'quot':
          return '"';
        case 'apos':
          return "'";
        case 'nbsp':
          return ' ';
        default: {
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
        }
      }
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
