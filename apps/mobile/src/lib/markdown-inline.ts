/**
 * Inline Markdown parsing for the mobile app (T-0049): text, bold, italic,
 * strike, inline code and links (`[label](url)` and bare `https://…`). Images
 * render as their alt text and raw HTML stays plain text. Links only pass for
 * `http:`, `https:` and `mailto:`; anything else stays a text node. Split out of
 * `markdown.ts` (T-1040) and re-exported there.
 */

import { parseUrl } from '@zilar/chat-core';

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
