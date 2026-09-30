// T-0125: best-effort web search behind a port, so a real provider
// (SearXNG, Exa) can later be added as one adapter. The only provider in
// this task is `duckduckgo-html`: one GET at
// `https://html.duckduckgo.com/html/?q=<query>`, parsed for result
// titles, URLs and snippets (at most 8). DuckDuckGo wraps result links
// in its own redirect (`//duckduckgo.com/l/?uddg=<target>&…`); the
// target is unwrapped, and anything that is not an http(s) URL is
// dropped. Never retried: one attempt per call, and any failure, block
// page, captcha or 0 parsed results is "search unavailable right now".

export const SEARCH_HOST = 'html.duckduckgo.com';
export const MAX_SEARCH_RESULTS = 8;

export interface WebSearchResult {
  title: string;
  url: string;
  snippet: string;
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

// Reads the recorded shape of the DuckDuckGo HTML result page: each
// `.result` block carries a `.result__a` title anchor and an optional
// `.result__snippet`. Title anchors without an unwrappable http(s) URL
// are skipped; snippets are plain text (empty is fine).
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

// Only a whole `result` token marks a result block: `results`,
// `results_links` and `result__body` are containers, not results.
function hasResultToken(classAttr: string): boolean {
  return classAttr.split(/\s+/).includes('result');
}

// Every top-level `<div class="… result …">…</div>` block, balanced by
// depth counting so nested divs do not cut a result short.
function resultBlocks(html: string): string[] {
  const blocks: string[] = [];
  const openPattern = /<div\b[^>]*\bclass="([^"]*)"[^>]*>/gi;
  let open: RegExpExecArray | null;
  while ((open = openPattern.exec(html)) !== null) {
    if (!hasResultToken(open[1] ?? '')) {
      continue;
    }
    const start = open.index;
    const depthPattern = /<\/?div\b[^>]*>/gi;
    depthPattern.lastIndex = open.index + open[0].length;
    let depth = 1;
    let tag: RegExpExecArray | null;
    let end = -1;
    while ((tag = depthPattern.exec(html)) !== null) {
      depth += tag[0].startsWith('</') ? -1 : 1;
      if (depth === 0) {
        end = tag.index + tag[0].length;
        break;
      }
    }
    if (end < 0) {
      break;
    }
    blocks.push(html.slice(start, end));
    openPattern.lastIndex = end;
    if (blocks.length >= MAX_SEARCH_RESULTS) {
      break;
    }
  }
  return blocks;
}

function anchorIn(block: string, className: string): { text: string; href: string | null } | null {
  const anchorPattern = /<a\b([^>]*)>([\s\S]*?)<\/a\s*>/gi;
  let match: RegExpExecArray | null;
  while ((match = anchorPattern.exec(block)) !== null) {
    const attrs = match[1] ?? '';
    const classes = attrValue(attrs, 'class')
      .split(/\s+/)
      .filter((entry) => entry.length > 0);
    if (!classes.includes(className)) {
      continue;
    }
    const inner = match[2] ?? '';
    const text = collapseForSearch(decodeForSearch(inner));
    const href = linkTarget(attrs);
    if (text.length === 0 && href === null) {
      continue;
    }
    return { text, href };
  }
  return null;
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
  // DuckDuckGo wraps result links in its own redirect
  // (`//duckduckgo.com/l/?uddg=<target>&…`): unwrap to the target.
  return unwrapDuckDuckGo(href);
}

function decodeForSearch(value: string): string {
  return value
    .replace(/&(amp|lt|gt|quot|apos|nbsp);/g, (_full, body: string) => {
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
        default:
          return ' ';
      }
    })
    .replace(/<[^>]*>/g, ' ');
}

function collapseForSearch(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

// `//duckduckgo.com/l/?uddg=<url-encoded target>&…` → the target, when
// it is an http(s) URL. The href may carry `&amp;` escapes from the
// page markup; those are decoded first. A plain http(s) href passes
// through unchanged; anything else (relative links, javascript:) is
// dropped.
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

export function formatSearchResults(query: string, results: WebSearchResult[]): string {
  const lines = results.map(
    (result, index) =>
      `${index + 1}. ${result.title}\n   ${result.url}${result.snippet.length > 0 ? `\n   ${result.snippet}` : ''}`,
  );
  return `Search results for "${query}" (unreliable, from DuckDuckGo HTML):\n${lines.join('\n')}`;
}
