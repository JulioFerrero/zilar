/**
 * A small, dependency-free Markdown parser for the mobile app, the counterpart
 * of the web's `react-markdown` safe subset (T-0049). It is pure and total: any
 * input, including a half-written AI draft, produces blocks without throwing.
 *
 * Supported blocks: paragraph, heading (1-6), fenced code (``` or ~~~, an
 * unclosed fence is a code block), blockquote, bullet list, numbered list
 * (keeping the source number) and horizontal rule. Inline: text, bold, italic,
 * strike, inline code, links (`[label](url)` and bare `https://…`). Images
 * render as their alt text and raw HTML stays plain text. Links only pass for
 * `http:`, `https:` and `mailto:`; anything else stays a text node.
 */

import { parseUrl } from '@zilar/chat-core';

const MAX_LENGTH = 20_000;

export type InlineNode =
  | { type: 'text'; value: string }
  | { type: 'bold'; value: string }
  | { type: 'italic'; value: string }
  | { type: 'strike'; value: string }
  | { type: 'code'; value: string }
  | { type: 'link'; value: string; href: string };

export interface ListItem {
  /** The source marker: `-`, `*`, `+` for bullets, `1.` / `2)` for ordered. */
  marker: string;
  nodes: InlineNode[];
}

export type Block =
  | { type: 'paragraph'; nodes: InlineNode[] }
  | { type: 'heading'; level: 1 | 2 | 3 | 4 | 5 | 6; nodes: InlineNode[] }
  | { type: 'code'; language?: string; value: string }
  | { type: 'quote'; nodes: InlineNode[] }
  | { type: 'list'; ordered: boolean; items: ListItem[] }
  | { type: 'hr' };

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

const ALLOWED_PROTOCOLS = new Set(['http:', 'https:', 'mailto:']);

/**
 * The URL only when its scheme is safe (`http:`, `https:`, `mailto:`). A
 * relative link or another scheme (`javascript:`, `data:`, `vbscript:`) returns
 * `undefined`, so the label stays plain text.
 */
export function safeMarkdownUrl(url: string): string | undefined {
  const parsed = parseUrl(url);
  if (parsed === undefined) {
    return undefined;
  }
  return ALLOWED_PROTOCOLS.has(parsed.protocol) ? url : undefined;
}

const ALWAYS_STRIP = new Set(['.', ',', ';', ':', '!', '?', '…', '»', '"', "'"]);
const BRACKETS: Record<string, string> = { '(': ')', '[': ']', '{': '}' };

function countCharacter(value: string, character: string): number {
  let total = 0;
  for (const item of value) {
    if (item === character) {
      total += 1;
    }
  }
  return total;
}

/** Mirrors `@zilar/chat-core`'s `trimTrailingPunctuation` for bare URLs. */
function trimTrailingPunctuation(raw: string): string {
  let url = raw;
  while (url.length > 0) {
    const last = url[url.length - 1];
    if (last === undefined) {
      break;
    }
    if (ALWAYS_STRIP.has(last)) {
      url = url.slice(0, -1);
      continue;
    }
    const opener = Object.entries(BRACKETS).find(([, closer]) => closer === last)?.[0];
    if (opener !== undefined && countCharacter(url, last) > countCharacter(url, opener)) {
      url = url.slice(0, -1);
      continue;
    }
    break;
  }
  return url;
}

interface InlineRule {
  regex: RegExp;
  build: (match: RegExpExecArray) => InlineNode[];
}

// Longest markers first, so `**bold**` never matches as an italic `*…*`.
const INLINE_RULES: InlineRule[] = [
  {
    regex: /!\[([^\]]*)\]\(((?:[^()]|\([^()]*\))*)\)/g,
    build: (match) => [{ type: 'text', value: match[1] ?? '' }],
  },
  {
    regex: /\[([^\]]*)\]\(((?:[^()]|\([^()]*\))*)\)/g,
    build: (match) => {
      const label = match[1] ?? '';
      const href = safeMarkdownUrl((match[2] ?? '').trim());
      return href === undefined
        ? [{ type: 'text', value: label }]
        : [{ type: 'link', value: label, href }];
    },
  },
  {
    regex: /(`+)([^\n]+?)\1/g,
    build: (match) => [{ type: 'code', value: match[2] ?? '' }],
  },
  {
    regex: /\*\*\*(?=\S)([\s\S]*?\S)\*\*\*/g,
    build: (match) => [{ type: 'bold', value: match[1] ?? '' }],
  },
  {
    regex: /___(?=\S)([\s\S]*?\S)___/g,
    build: (match) => [{ type: 'bold', value: match[1] ?? '' }],
  },
  {
    regex: /\*\*(?=\S)([\s\S]*?\S)\*\*/g,
    build: (match) => [{ type: 'bold', value: match[1] ?? '' }],
  },
  {
    regex: /__(?=\S)([\s\S]*?\S)__/g,
    build: (match) => [{ type: 'bold', value: match[1] ?? '' }],
  },
  {
    regex: /(?<![\w*])\*(?=\S)([^*\n]*?\S)\*(?![\w*])/g,
    build: (match) => [{ type: 'italic', value: match[1] ?? '' }],
  },
  {
    regex: /(?<![\w])_(?=\S)([^_\n]*?\S)_(?![\w])/g,
    build: (match) => [{ type: 'italic', value: match[1] ?? '' }],
  },
  {
    regex: /~~(?=\S)([\s\S]*?\S)~~/g,
    build: (match) => [{ type: 'strike', value: match[1] ?? '' }],
  },
  {
    regex: /\bhttps?:\/\/[^\s<]+/gi,
    build: (match) => {
      const raw = match[0];
      const url = trimTrailingPunctuation(raw);
      const href = safeMarkdownUrl(url);
      if (href === undefined) {
        return [{ type: 'text', value: raw }];
      }
      const nodes: InlineNode[] = [{ type: 'link', value: url, href }];
      const trailing = raw.slice(url.length);
      if (trailing.length > 0) {
        nodes.push({ type: 'text', value: trailing });
      }
      return nodes;
    },
  },
];

function pushText(nodes: InlineNode[], value: string): void {
  if (value.length === 0) {
    return;
  }
  const last = nodes[nodes.length - 1];
  if (last !== undefined && last.type === 'text') {
    last.value += value;
    return;
  }
  nodes.push({ type: 'text', value });
}

function pushNode(nodes: InlineNode[], node: InlineNode): void {
  if (node.type === 'text') {
    pushText(nodes, node.value);
    return;
  }
  nodes.push(node);
}

/**
 * Parses the inline nodes of one line of text. The earliest match wins; a
 * marker with no pair simply stays in the text.
 */
export function parseInline(text: string): InlineNode[] {
  const nodes: InlineNode[] = [];
  let index = 0;

  while (index < text.length) {
    let bestIndex = -1;
    let bestEnd = -1;
    let bestNodes: InlineNode[] = [];

    for (const rule of INLINE_RULES) {
      rule.regex.lastIndex = index;
      const match = rule.regex.exec(text);
      if (match === null) {
        continue;
      }
      const start = match.index;
      if (bestIndex !== -1 && start >= bestIndex) {
        continue;
      }
      bestIndex = start;
      bestEnd = start + match[0].length;
      bestNodes = rule.build(match);
    }

    if (bestIndex === -1) {
      pushText(nodes, text.slice(index));
      break;
    }
    if (bestIndex > index) {
      pushText(nodes, text.slice(index, bestIndex));
    }
    for (const node of bestNodes) {
      pushNode(nodes, node);
    }
    index = bestEnd > index ? bestEnd : index + 1;
  }

  return nodes;
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
