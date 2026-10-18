// T-1988: linear markup scans. The old regexes (`/<[^>]*>/`,
// `/<!--[\s\S]*?-->/` and the lazy element patterns) slowed down with the
// square of the input on crafted pages and message stanzas. Every helper here
// walks the string once with indexOf-style scans, so a 2 MiB body stays
// linear. Matching is case-insensitive, as the regexes were.
const MAX_TAG_ATTRIBUTE_CHARS = 2000;

export interface TagMatch {
  /** Index of the opening `<`. */
  start: number;
  /** Index just after the closing `>`. */
  end: number;
  closing: boolean;
  selfClosing: boolean;
  /** Attribute text between the tag name and `>`, capped at 2,000 characters. */
  attrs: string;
}

export interface ElementMatch {
  attrs: string;
  inner: string;
}

/** The next `<tag …>` or `</tag …>`, or null. */
export function nextTag(input: string, tag: string, from = 0): TagMatch | null {
  if (tag.length === 0) {
    return null;
  }
  const first = fold(tag[0] ?? '');
  for (let index = Math.max(0, from); index < input.length; index += 1) {
    if (input[index] !== '<') {
      continue;
    }
    let nameStart = index + 1;
    const closing = input[nameStart] === '/';
    if (closing) {
      nameStart += 1;
    }
    const actualFirst = input[nameStart];
    if (actualFirst === undefined || fold(actualFirst) !== first) {
      continue;
    }
    if (!matchesTagName(input, nameStart, tag) || isNameChar(input[nameStart + tag.length])) {
      continue;
    }
    const nameEnd = nameStart + tag.length;
    const gt = input.indexOf('>', nameEnd);
    if (gt < 0) {
      return null;
    }
    return {
      start: index,
      end: gt + 1,
      closing,
      selfClosing: !closing && slashBefore(input, nameEnd, gt),
      attrs: input.slice(nameEnd, Math.min(gt, nameEnd + MAX_TAG_ATTRIBUTE_CHARS)),
    };
  }
  return null;
}

/** The next opening `<tag …>`, skipping closing tags, or null. */
export function nextOpenTag(input: string, tag: string, from = 0): TagMatch | null {
  let cursor = from;
  while (true) {
    const match = nextTag(input, tag, cursor);
    if (match === null || !match.closing) {
      return match;
    }
    cursor = match.end;
  }
}

/** The index of the next `</tag\s*>`, or null. */
export function findCloseTag(input: string, tag: string, from = 0): number | null {
  if (tag.length === 0) {
    return null;
  }
  const first = fold(tag[0] ?? '');
  for (let index = Math.max(0, from); index < input.length; index += 1) {
    if (input[index] !== '<' || input[index + 1] !== '/') {
      continue;
    }
    const nameStart = index + 2;
    const actualFirst = input[nameStart];
    if (actualFirst === undefined || fold(actualFirst) !== first) {
      continue;
    }
    if (!matchesTagName(input, nameStart, tag)) {
      continue;
    }
    let cursor = nameStart + tag.length;
    while (cursor < input.length && isSpace(input[cursor] ?? '')) {
      cursor += 1;
    }
    if (input[cursor] === '>') {
      return index;
    }
  }
  return null;
}

/** Replaces every comment with one space; an unclosed `<!--` drops the rest. */
export function stripComments(input: string): string {
  const parts: string[] = [];
  let cursor = 0;
  while (cursor < input.length) {
    const start = input.indexOf('<!--', cursor);
    if (start < 0) {
      parts.push(input.slice(cursor));
      break;
    }
    parts.push(input.slice(cursor, start));
    const end = input.indexOf('-->', start + 4);
    if (end < 0) {
      break;
    }
    parts.push(' ');
    cursor = end + 3;
  }
  return parts.join('');
}

/** Replaces every `<…>` tag with `replacement`; an unclosed `<` drops the rest. */
export function stripTags(input: string, replacement = ' '): string {
  const parts: string[] = [];
  let cursor = 0;
  let pendingTags = 0;
  const flushTags = (): void => {
    if (pendingTags > 0) {
      parts.push(replacement.repeat(pendingTags));
      pendingTags = 0;
    }
  };
  while (cursor < input.length) {
    const start = input.indexOf('<', cursor);
    if (start < 0) {
      flushTags();
      parts.push(input.slice(cursor));
      break;
    }
    if (start > cursor) {
      flushTags();
      parts.push(input.slice(cursor, start));
    }
    const end = input.indexOf('>', start + 1);
    if (end < 0) {
      flushTags();
      break;
    }
    pendingTags += 1;
    cursor = end + 1;
  }
  flushTags();
  return parts.join('');
}

/** The inner text of every `<tag …>…</tag>` block, up to `limit` blocks. */
export function elementBlocks(input: string, tag: string, limit: number): string[] {
  const blocks: string[] = [];
  let cursor = 0;
  while (blocks.length < limit) {
    const open = nextOpenTag(input, tag, cursor);
    if (open === null) {
      break;
    }
    const closeStart = findCloseTag(input, tag, open.end);
    if (closeStart === null) {
      break;
    }
    blocks.push(input.slice(open.end, closeStart));
    cursor = closeStart + 1;
  }
  return blocks;
}

/** The first `<tag …>…</tag>` block's attributes and inner text, or null. */
export function firstElement(input: string, tag: string): ElementMatch | null {
  const open = nextOpenTag(input, tag, 0);
  if (open === null) {
    return null;
  }
  const closeStart = findCloseTag(input, tag, open.end);
  if (closeStart === null) {
    return null;
  }
  return { attrs: open.attrs, inner: input.slice(open.end, closeStart) };
}

/** The attribute text of the first `<tag …>`, or null. */
export function openTagAttrs(input: string, tag: string): string | null {
  return nextOpenTag(input, tag, 0)?.attrs ?? null;
}

function matchesTagName(input: string, at: number, tag: string): boolean {
  if (at + tag.length > input.length) {
    return false;
  }
  for (let index = 0; index < tag.length; index += 1) {
    const char = input[at + index];
    if (char === undefined || fold(char) !== fold(tag[index] ?? '')) {
      return false;
    }
  }
  return true;
}

function fold(char: string): string {
  return char >= 'A' && char <= 'Z' ? char.toLowerCase() : char;
}

function isNameChar(char: string | undefined): boolean {
  return (
    char !== undefined &&
    ((char >= 'a' && char <= 'z') ||
      (char >= 'A' && char <= 'Z') ||
      (char >= '0' && char <= '9') ||
      char === '_')
  );
}

function isSpace(char: string): boolean {
  return (
    char === ' ' ||
    char === '\t' ||
    char === '\n' ||
    char === '\r' ||
    char === '\f' ||
    char === '\v'
  );
}

function slashBefore(input: string, from: number, gt: number): boolean {
  for (let index = gt - 1; index >= from; index -= 1) {
    const char = input[index] ?? '';
    if (isSpace(char)) {
      continue;
    }
    return char === '/';
  }
  return false;
}
