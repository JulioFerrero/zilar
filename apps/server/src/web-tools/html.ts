// A small hand-written HTML extractor, no dependency. Drops script/style/head/nav
// and comments; keeps the title, headings, paragraphs, list items and http(s)
// link text. Input is capped so malformed HTML cannot hang the server, and the
// output is plain text for `modelText`.
// effect-plain: pure HTML-to-text extraction; malformed input yields text, no I/O
import { decodeHtmlEntities } from '../markup/entities';
import { findCloseTag, nextOpenTag, stripComments, stripTags } from '../markup/scan';

const MAX_HTML_INPUT_CHARS = 2 * 1024 * 1024;
// Attribute regexes only ever read one bounded tag's text.
const MAX_TAG_TEXT_CHARS = 2000;

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

export function extractText(html: string): string {
  const input = html.length > MAX_HTML_INPUT_CHARS ? html.slice(0, MAX_HTML_INPUT_CHARS) : html;
  const withoutComments = stripComments(input);
  const out: string[] = [];
  const dropStack: string[] = [];
  // The innermost open anchor's href, when not inside a dropped element.
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
    const tagText = raw.slice(0, MAX_TAG_TEXT_CHARS);
    const name = tagNameOf(isClose ? tagText.slice(1) : tagText);
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
      linkStack.push(linkHrefOf(tagText));
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

// Only http(s) targets: javascript, mailto and relative links never reach the model.
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
  out.push(decodeHtmlEntities(chunk));
}

function collapseWhitespace(value: string): string {
  return value
    .split('\n')
    .map((line) => line.replace(/[ \t\r\f\v\u00a0]+/g, ' ').trim())
    .filter((line) => line.length > 0)
    .join('\n');
}

// An anchor's text and href from a search-result fragment.
export interface AnchorParts {
  text: string;
  href: string | null;
}

export function anchorParts(fragment: string): AnchorParts | null {
  const open = nextOpenTag(fragment, 'a', 0);
  if (open === null) {
    return null;
  }
  const closeAt = findCloseTag(fragment, 'a', open.end);
  const inner = closeAt === null ? fragment.slice(open.end) : fragment.slice(open.end, closeAt);
  const text = collapseWhitespace(decodeHtmlEntities(stripTags(inner, ' ')));
  const href = linkHrefOf(`a ${open.attrs}`);
  if (text.length === 0 && href === null) {
    return null;
  }
  return { text, href };
}
