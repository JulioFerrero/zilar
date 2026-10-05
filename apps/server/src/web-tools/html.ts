// T-0125: a small hand-written HTML extractor. No new dependency.
//
// Drops script/style/head/nav (and comments), keeps the title, headings,
// paragraphs, list items and link text with hrefs, decodes the common
// entities, and collapses whitespace. Input is capped so huge or
// malformed HTML cannot hang the server; output is plain text the
// adapters put in `modelText` (never in a summary).
const MAX_HTML_INPUT_CHARS = 2 * 1024 * 1024;

const DROP_ELEMENTS = new Set(['script', 'style', 'head', 'nav', 'noscript', 'template']);

const BLOCK_ELEMENTS = new Set([
  'title',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'p',
  'li',
  'div',
  'section',
  'article',
  'header',
  'footer',
  'main',
  'blockquote',
  'pre',
  'tr',
  'br',
  'hr',
]);

const ENTITY_MAP: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
};

export function extractText(html: string): string {
  const input = html.length > MAX_HTML_INPUT_CHARS ? html.slice(0, MAX_HTML_INPUT_CHARS) : html;
  const withoutComments = input.replace(/<!--[\s\S]*?-->/g, ' ');
  const out: string[] = [];
  const dropStack: string[] = [];
  // The href of the innermost open anchor, when not inside a dropped
  // element. Only http(s) targets are kept.
  const linkStack: (string | null)[] = [];
  let pos = 0;
  while (pos < withoutComments.length) {
    const nextTag = withoutComments.indexOf('<', pos);
    if (nextTag < 0) {
      pushText(out, withoutComments.slice(pos), dropStack.length > 0);
      break;
    }
    if (nextTag > pos) {
      pushText(out, withoutComments.slice(pos, nextTag), dropStack.length > 0);
    }
    const tagEnd = withoutComments.indexOf('>', nextTag + 1);
    if (tagEnd < 0) {
      break;
    }
    const raw = withoutComments.slice(nextTag + 1, tagEnd).trim();
    pos = tagEnd + 1;
    if (raw.length === 0) {
      continue;
    }
    if (raw.startsWith('!') || raw.startsWith('?')) {
      continue;
    }
    const isClose = raw.startsWith('/');
    const name = tagNameOf(isClose ? raw.slice(1) : raw);
    if (name === null) {
      continue;
    }
    if (isClose) {
      if (name === 'a') {
        const href = linkStack.pop();
        if (href !== undefined && href !== null && dropStack.length === 0) {
          out.push(` (${href})`);
        }
      } else if (dropStack.length > 0 && dropStack[dropStack.length - 1] === name) {
        dropStack.pop();
      } else if (DROP_ELEMENTS.has(name)) {
        const at = dropStack.lastIndexOf(name);
        if (at >= 0) {
          dropStack.splice(at, 1);
        }
      }
      if (BLOCK_ELEMENTS.has(name) && dropStack.length === 0) {
        out.push('\n');
      }
      continue;
    }
    const selfClosing = raw.endsWith('/');
    if (DROP_ELEMENTS.has(name)) {
      if (!selfClosing) {
        dropStack.push(name);
      }
      continue;
    }
    if (name === 'a') {
      linkStack.push(linkHrefOf(raw));
      continue;
    }
    if (dropStack.length > 0) {
      continue;
    }
    if (BLOCK_ELEMENTS.has(name)) {
      out.push('\n');
    }
  }
  const text = collapseWhitespace(out.join(''));
  return text;
}

function tagNameOf(raw: string): string | null {
  const match = /^[a-zA-Z][a-zA-Z0-9-]*/.exec(raw);
  if (match === null) {
    return null;
  }
  return match[0].toLowerCase();
}

// The anchor's href, kept only when it is an http(s) target: javascript:,
// mailto: and relative links never reach the model.
function linkHrefOf(rawTag: string): string | null {
  const match = /\bhref\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(rawTag);
  if (match === null) {
    return null;
  }
  const href = (match[2] ?? match[3] ?? match[4] ?? '').trim();
  if (/^https?:\/\//i.test(href)) {
    return href;
  }
  return null;
}

function pushText(out: string[], chunk: string, dropped: boolean): void {
  if (dropped) {
    return;
  }
  out.push(decodeEntities(chunk));
}

function decodeEntities(value: string): string {
  return value.replace(/&(#\d+|#x[0-9a-fA-F]+|[a-zA-Z][a-zA-Z0-9]+);/g, (full, body: string) => {
    const named = ENTITY_MAP[body];
    if (named !== undefined) {
      return named;
    }
    if (body.startsWith('#')) {
      const code =
        body[1] === 'x' || body[1] === 'X'
          ? Number.parseInt(body.slice(2), 16)
          : Number.parseInt(body.slice(1), 10);
      if (Number.isInteger(code) && code >= 0 && code <= 0x10ffff) {
        try {
          return String.fromCodePoint(code);
        } catch {
          return full;
        }
      }
    }
    return full;
  });
}

function collapseWhitespace(value: string): string {
  return value
    .split('\n')
    .map((line) => line.replace(/[ \t\r\f\v\u00a0]+/g, ' ').trim())
    .filter((line) => line.length > 0)
    .join('\n');
}

// Pulls one anchor's visible text and href out of an HTML fragment such
// as a search-result block. Used by the search provider to read the
// result title and unwrap redirect links to the target URL.
export interface AnchorParts {
  text: string;
  href: string | null;
}

export function anchorParts(fragment: string): AnchorParts | null {
  const open = /<a\b([^>]*)>/i.exec(fragment);
  if (open === null) {
    return null;
  }
  const attrs = (open[1] ?? '') as string;
  const afterOpen = fragment.slice(open.index + open[0].length);
  const closeAt = afterOpen.search(/<\/a\s*>/i);
  const inner = closeAt < 0 ? afterOpen : afterOpen.slice(0, closeAt);
  const text = collapseWhitespace(decodeEntities(stripTags(inner)));
  const href = linkHrefOf(`a ${attrs}`);
  if (text.length === 0 && href === null) {
    return null;
  }
  return { text, href };
}

function stripTags(value: string): string {
  return value.replace(/<[^>]*>/g, ' ');
}
