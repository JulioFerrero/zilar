export interface LightBlock {
  kind: 'text' | 'code';
  text: string;
  /** Offset of the block in the original text, for shifting mention ranges. */
  start: number;
}

export interface LightInline {
  kind: 'text' | 'bold' | 'italic' | 'code';
  text: string;
}

/**
 * A fence is a line starting with three backticks. An optional language tag on
 * the opening fence is dropped with the fence line itself.
 */
function isFence(line: string): boolean {
  return line.replace(/\r$/, '').startsWith('```');
}

/**
 * Splits text into plain-text and fenced-code blocks. A fence opens a `code`
 * block only when a closing fence follows; an unclosed fence stays plain text.
 * A `code` block's `text` is the inner lines, a `text` block's `text` is an
 * exact slice of the original, and `start` is the block's offset in it. Pure
 * and total; it never throws.
 */
export function splitCodeBlocks(text: string): LightBlock[] {
  const lines = text.split('\n');
  const starts: number[] = [];
  let offset = 0;
  for (const line of lines) {
    starts.push(offset);
    offset += line.length + 1;
  }

  const blocks: LightBlock[] = [];
  let runStart = 0;
  let index = 0;
  while (index < lines.length) {
    if (!isFence(lines[index] ?? '')) {
      index += 1;
      continue;
    }
    let close = index + 1;
    while (close < lines.length && !isFence(lines[close] ?? '')) {
      close += 1;
    }
    if (close >= lines.length) {
      // Unclosed fence: plain text, keep scanning after it.
      index += 1;
      continue;
    }
    if (index > runStart) {
      blocks.push({
        kind: 'text',
        text: text.slice(starts[runStart] ?? 0, starts[index] ?? 0),
        start: starts[runStart] ?? 0,
      });
    }
    blocks.push({
      kind: 'code',
      text: lines
        .slice(index + 1, close)
        .map((line) => line.replace(/\r$/, ''))
        .join('\n'),
      start: starts[index] ?? 0,
    });
    index = close + 1;
    runStart = index;
  }
  const tailStart = starts[runStart] ?? text.length;
  if (runStart < lines.length && tailStart < text.length) {
    blocks.push({ kind: 'text', text: text.slice(tailStart), start: tailStart });
  }
  return blocks;
}

const BOLD_PATTERN = /\*\*(?=\S)([\s\S]*?\S)\*\*/.source;
const CODE_PATTERN = /`(?=[^`\s])((?:[^`]*[^`\s])?)`/.source;
const UNDERSCORE_PATTERN = /(?<![\w])_(?=\S)([^_\n]*?[^_\s])_(?![\w])/.source;
const STAR_PATTERN = /(?<!\*)\*(?=\S)([^*\n]*?[^*\s])\*(?!\*)/.source;
const LIGHT_INLINE_PATTERN = new RegExp(
  `${BOLD_PATTERN}|${CODE_PATTERN}|${UNDERSCORE_PATTERN}|${STAR_PATTERN}`,
  'g',
);

/**
 * Splits text into `**bold**`, `*italic*` / `_italic_` and `` `code` ``
 * segments. Markers need a non-space character right inside them, `_` italics
 * only apply at word edges (so `snake_case_name` stays literal), and unmatched
 * markers stay literal (`2 * 3`). Nesting is not parsed: inside `code` nothing
 * else applies. Pure and total; it never throws.
 */
export function parseLightInline(text: string): LightInline[] {
  const segments: LightInline[] = [];
  let cursor = 0;
  for (const match of text.matchAll(LIGHT_INLINE_PATTERN)) {
    const full = match[0] ?? '';
    const index = match.index ?? 0;
    if (index > cursor) {
      segments.push({ kind: 'text', text: text.slice(cursor, index) });
    }
    const [, bold, code, underscore, star] = match;
    if (bold !== undefined) {
      segments.push({ kind: 'bold', text: bold });
    } else if (code !== undefined) {
      segments.push({ kind: 'code', text: code });
    } else if (underscore !== undefined) {
      segments.push({ kind: 'italic', text: underscore });
    } else if (star !== undefined) {
      segments.push({ kind: 'italic', text: star });
    } else {
      segments.push({ kind: 'text', text: full });
    }
    cursor = index + full.length;
  }
  if (cursor < text.length) {
    segments.push({ kind: 'text', text: text.slice(cursor) });
  }
  return segments;
}

/**
 * The same text with the light markers removed and fences dropped (keeping the
 * code), collapsed to one line for list previews. Pure and total.
 */
export function lightToPlain(text: string): string {
  const parts = splitCodeBlocks(text).map((block) =>
    block.kind === 'code'
      ? block.text
      : parseLightInline(block.text)
          .map((segment) => segment.text)
          .join(''),
  );
  return parts.join('\n').replace(/\s+/g, ' ').trim();
}
