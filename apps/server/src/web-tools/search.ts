// Best-effort search behind a port, so another provider can be added later. The
// `duckduckgo-html` provider does one GET, parses at most 8 results and unwraps
// DuckDuckGo's redirect; a non-http(s) target is dropped. Never retried: any
// failure, block page or 0 results is "unavailable".
import { findCloseTag, nextTag, stripTags } from '../markup/scan';

export const SEARCH_HOST = 'html.duckduckgo.com';
export const MAX_SEARCH_RESULTS = 8;

export interface WebSearchResult {
  title: string;
  url: string;
  snippet: string;
  date?: string;
  site?: string;
}

export interface WebSearchProvider {
  search(query: string, options: { limit: number }): Promise<WebSearchResult[]>;
}

export function duckduckgoUrl(query: string): string {
  return `https://${SEARCH_HOST}/html/?${new URLSearchParams({ q: query }).toString()}`;
}

const BLOCK_MARKERS = [/anomaly-modal/i, /challenge-form/i, /did not match any documents/i];

export function isBlockedPage(html: string): boolean {
  return BLOCK_MARKERS.some((marker) => marker.test(html));
}

// Each `.result` block carries a `.result__a` title anchor and an optional
// `.result__snippet`. A title without an http(s) URL is skipped.
export function parseDuckDuckGo(html: string): WebSearchResult[] {
  if (isBlockedPage(html)) {
    return [];
  }
  const results: WebSearchResult[] = [];
  for (const block of resultBlocks(html)) {
    if (results.length >= MAX_SEARCH_RESULTS) {
      break;
    }
    const titleAnchor = anchorIn(block, 'result__a');
    if (titleAnchor === null) {
      continue;
    }
    const url = unwrapDuckDuckGo(titleAnchor.href);
    if (url === null) {
      continue;
    }
    const title = titleAnchor.text;
    if (title.length === 0) {
      continue;
    }
    const snippetAnchor = anchorIn(block, 'result__snippet');
    results.push({
      title,
      url,
      snippet: snippetAnchor === null ? '' : snippetAnchor.text,
    });
  }
  return results;
}

// Only a whole `result` token counts: `results` and `result__body` are containers.
function hasResultToken(classAttr: string): boolean {
  return classAttr.split(/\s+/).includes('result');
}

// Balanced by depth, so nested divs do not cut a result short.
function resultBlocks(html: string): string[] {
  const blocks: string[] = [];
  let cursor = 0;
  while (blocks.length < MAX_SEARCH_RESULTS) {
    const open = nextTag(html, 'div', cursor);
    if (open === null) {
      break;
    }
    if (open.closing || !hasResultToken(attrValue(open.attrs, 'class'))) {
      cursor = open.end;
      continue;
    }
    const end = balancedDivEnd(html, open.end);
    if (end === null) {
      break;
    }
    blocks.push(html.slice(open.start, end));
    cursor = end;
  }
  return blocks;
}

function balancedDivEnd(html: string, from: number): number | null {
  let depth = 1;
  let cursor = from;
  while (depth > 0) {
    const tag = nextTag(html, 'div', cursor);
    if (tag === null) {
      return null;
    }
    depth += tag.closing ? -1 : 1;
    cursor = tag.end;
  }
  return cursor;
}

function anchorIn(block: string, className: string): { text: string; href: string | null } | null {
  let cursor = 0;
  while (true) {
    const open = nextTag(block, 'a', cursor);
    if (open === null) {
      return null;
    }
    if (open.closing) {
      cursor = open.end;
      continue;
    }
    const closeStart = findCloseTag(block, 'a', open.end);
    if (closeStart === null) {
      return null;
    }
    const classes = attrValue(open.attrs, 'class')
      .split(/\s+/)
      .filter((entry) => entry.length > 0);
    if (!classes.includes(className)) {
      cursor = closeStart + 1;
      continue;
    }
    const inner = block.slice(open.end, closeStart);
    const text = collapseForSearch(decodeForSearch(inner));
    const href = linkTarget(open.attrs);
    if (text.length === 0 && href === null) {
      cursor = closeStart + 1;
      continue;
    }
    return { text, href };
  }
}

function attrValue(attrs: string, name: string): string {
  const match = new RegExp(`\\b${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i').exec(attrs);
  if (match === null) {
    return '';
  }
  return match[2] ?? match[3] ?? match[4] ?? '';
}

function linkTarget(attrs: string): string | null {
  const raw = attrValue(attrs, 'href').trim();
  const href = raw.replace(/&amp;/g, '&');
  if (/^https?:\/\//i.test(href)) {
    return href;
  }
  // Unwrap DuckDuckGo's own redirect (`//duckduckgo.com/l/?uddg=…`).
  return unwrapDuckDuckGo(href);
}

// The named HTML entities both parsers meet; a numeric entity is left to the caller.
export function decodeNamedEntity(body: string): string | undefined {
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
    default:
      return undefined;
  }
}

function decodeForSearch(value: string): string {
  return stripTags(
    value.replace(
      /&(amp|lt|gt|quot|apos|nbsp);/g,
      (_full, body: string) => decodeNamedEntity(body) ?? ' ',
    ),
    ' ',
  );
}

function collapseForSearch(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

// `//duckduckgo.com/l/?uddg=<target>` → the target when it is http(s); `&amp;` is
// decoded first. A plain http(s) href passes through, anything else is dropped.
export function unwrapDuckDuckGo(href: string | null): string | null {
  if (href === null) {
    return null;
  }
  const decoded = href.replace(/&amp;/g, '&');
  const redirect = /^(?:https?:)?\/\/duckduckgo\.com\/l\/\?(.*)$/i.exec(decoded);
  if (redirect === null) {
    return /^https?:\/\//i.test(href) ? href : null;
  }
  const params = new URLSearchParams(redirect[1] ?? '');
  const target = params.get('uddg');
  if (target !== null && /^https?:\/\//i.test(target)) {
    return target;
  }
  return null;
}

export function searchUnavailableText(): string {
  return [
    'Web search is unavailable right now.',
    'Try web.wikipedia for a topic summary,',
    'web.feed for a news feed,',
    'or web.fetch with a known URL instead.',
  ].join(' ');
}

export function formatSearchResults(
  query: string,
  results: WebSearchResult[],
  source: string,
): string {
  const lines = results.map((result, index) => {
    const site = result.site === undefined ? '' : `\n   ${result.site}`;
    const date = result.date === undefined ? '' : `\n   ${result.date}`;
    const snippet = result.snippet.length > 0 ? `\n   ${result.snippet}` : '';
    return `${index + 1}. ${result.title}\n   ${result.url}${site}${date}${snippet}`;
  });
  return `Search results for "${query}" (from ${source}):\n${lines.join('\n')}`;
}
