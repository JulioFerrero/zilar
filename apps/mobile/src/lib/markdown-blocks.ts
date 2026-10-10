/**
 * Block-level Markdown parsing for the mobile app (T-0049): paragraph, heading
 * (1-6), fenced code (``` or ~~~, an unclosed fence is a code block),
 * blockquote, bullet list, numbered list (keeping the source number) and
 * horizontal rule. Pure and total: any input, including a half-written AI
 * draft, produces blocks without throwing. Split out of `markdown.ts` (T-1040)
 * and re-exported there.
 */

import { parseInline, type Block, type InlineNode, type ListItem } from './markdown-inline';

const MAX_LENGTH = 20_000;

const FENCE_OPEN = /^ {0,3}(`{3,}|~{3,})\s*(.*)$/;
const HEADING = /^ {0,3}(#{1,6})\s+(.*)$/;
const BLOCKQUOTE = /^ {0,3}>\s?/;
const HORIZONTAL_RULE = /^ {0,3}(?:[-*_]\s*){3,}$/;
const LIST_ITEM = /^( *)(?:([-*+])|(\d{1,9})([.)]))[ \t]+(.*)$/;
const BLANK = /^\s*$/;

function isBlank(line: string): boolean {
  return BLANK.test(line);
}

function isBlockStart(line: string): boolean {
  return (
    FENCE_OPEN.test(line) ||
    HEADING.test(line) ||
    BLOCKQUOTE.test(line) ||
    HORIZONTAL_RULE.test(line) ||
    LIST_ITEM.test(line)
  );
}

function parseFence(lines: string[], start: number): { block: Block; end: number } {
  const open = FENCE_OPEN.exec(lines[start] ?? '') as RegExpExecArray;
  const marker = open[1] ?? '```';
  const character = marker[0] === '~' ? '~' : '`';
  const closing = new RegExp(`^ {0,3}${character}{${marker.length},}\\s*$`);
  const info = (open[2] ?? '').trim();
  const language = info.length > 0 ? (info.split(/\s+/)[0] ?? undefined) : undefined;

  const content: string[] = [];
  let index = start + 1;
  while (index < lines.length && !closing.test(lines[index] ?? '')) {
    content.push(lines[index] ?? '');
    index += 1;
  }
  // Consume the closing fence when one is present; an unclosed fence at the end
  // of the text is still a code block.
  if (index < lines.length) {
    index += 1;
  }

  const block: Block =
    language === undefined
      ? { type: 'code', value: content.join('\n') }
      : { type: 'code', language, value: content.join('\n') };
  return { block, end: index };
}

function parseList(lines: string[], start: number): { block: Block; end: number } | undefined {
  const first = LIST_ITEM.exec(lines[start] ?? '');
  if (first === null) {
    return undefined;
  }
  const baseIndent = (first[1] ?? '').length;
  const ordered = first[3] !== undefined;
  const rawItems: { marker: string; text: string }[] = [];
  let index = start;

  while (index < lines.length) {
    const line = lines[index] ?? '';
    if (isBlank(line)) {
      break;
    }
    const match = LIST_ITEM.exec(line);
    const indent = (match?.[1] ?? '').length;
    if (match !== null && indent === baseIndent) {
      if ((match[3] !== undefined) !== ordered) {
        break;
      }
      const marker = ordered ? `${match[3] ?? ''}${match[4] ?? '.'}` : (match[2] ?? '-');
      rawItems.push({ marker, text: (match[5] ?? '').trim() });
      index += 1;
      continue;
    }
    const current = rawItems[rawItems.length - 1];
    if (current === undefined) {
      break;
    }
    // A deeper-indented item or an indented continuation joins the current item;
    // an unindented line ends the list.
    const isContinuation = match !== null ? indent > baseIndent : /^\s+\S/.test(line);
    if (!isContinuation) {
      break;
    }
    const text = match !== null ? (match[5] ?? '').trim() : line.trim();
    if (text.length > 0) {
      current.text = `${current.text} ${text}`.trim();
    }
    index += 1;
  }

  const items: ListItem[] = rawItems.map((item) => ({
    marker: item.marker,
    nodes: parseInline(item.text),
  }));
  return { block: { type: 'list', ordered, items }, end: index };
}

function parseQuote(lines: string[], start: number): { nodes: InlineNode[]; end: number } {
  const text: string[] = [];
  let index = start;
  while (index < lines.length && BLOCKQUOTE.test(lines[index] ?? '')) {
    let line = lines[index] ?? '';
    while (BLOCKQUOTE.test(line)) {
      line = line.replace(BLOCKQUOTE, '');
    }
    text.push(line.trim());
    index += 1;
  }
  return { nodes: parseInline(text.join(' ').trim()), end: index };
}

/**
 * Parses Markdown into a flat list of blocks. Pure and total; an input over
 * 20,000 characters is returned as a single plain paragraph so the phone never
 * spends time parsing a runaway draft.
 */
export function parseMarkdown(text: string): Block[] {
  if (text.length === 0) {
    return [];
  }
  if (text.length > MAX_LENGTH) {
    return [{ type: 'paragraph', nodes: [{ type: 'text', value: text }] }];
  }

  const lines = text.split(/\r?\n/);
  const blocks: Block[] = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index] ?? '';
    if (isBlank(line)) {
      index += 1;
      continue;
    }

    if (FENCE_OPEN.test(line)) {
      const parsed = parseFence(lines, index);
      blocks.push(parsed.block);
      index = parsed.end;
      continue;
    }

    if (HORIZONTAL_RULE.test(line)) {
      blocks.push({ type: 'hr' });
      index += 1;
      continue;
    }

    const heading = HEADING.exec(line);
    if (heading !== null) {
      const level = Math.min(6, (heading[1] ?? '').length) as 1 | 2 | 3 | 4 | 5 | 6;
      blocks.push({ type: 'heading', level, nodes: parseInline((heading[2] ?? '').trim()) });
      index += 1;
      continue;
    }

    if (BLOCKQUOTE.test(line)) {
      const parsed = parseQuote(lines, index);
      blocks.push({ type: 'quote', nodes: parsed.nodes });
      index = parsed.end;
      continue;
    }

    const list = parseList(lines, index);
    if (list !== undefined) {
      blocks.push(list.block);
      index = list.end;
      continue;
    }

    const paragraph: string[] = [];
    while (index < lines.length) {
      const current = lines[index] ?? '';
      if (isBlank(current) || isBlockStart(current)) {
        break;
      }
      paragraph.push(current.trim());
      index += 1;
    }
    blocks.push({ type: 'paragraph', nodes: parseInline(paragraph.join(' ')) });
  }

  return blocks;
}
