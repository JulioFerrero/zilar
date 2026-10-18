// effect-plain: total Markdown parse; a failed parse is a value, not an error
/**
 * A small, safe Markdown AST shared by web and mobile (T-2033). The parser is
 * the mdast/micromark GFM stack the web app already runs, so both platforms
 * read the same AI reply the same way. Links only pass for `http:`, `https:`
 * and `mailto:`; raw HTML is dropped, images become their alt text and unknown
 * nodes become their text content. Pure and total: any input returns blocks.
 */
import { fromMarkdown } from 'mdast-util-from-markdown';
import { gfmFromMarkdown } from 'mdast-util-gfm';
import { gfm } from 'micromark-extension-gfm';
import { parseUrl } from './url';

/** The most characters of a message the parser reads. */
export const MARKDOWN_INPUT_LIMIT = 20000;

export type MdTableAlign = 'left' | 'center' | 'right' | null;

export type MdInline =
  | { type: 'text'; value: string }
  | { type: 'strong'; children: MdInline[] }
  | { type: 'em'; children: MdInline[] }
  | { type: 'del'; children: MdInline[] }
  | { type: 'code'; value: string }
  | { type: 'link'; href: string; children: MdInline[] }
  | { type: 'break' };

export interface MdListItem {
  checked?: boolean;
  children: MdBlock[];
}

export type MdBlock =
  | { type: 'paragraph'; children: MdInline[] }
  | { type: 'heading'; level: 1 | 2 | 3 | 4 | 5 | 6; children: MdInline[] }
  | { type: 'code'; lang?: string; value: string }
  | { type: 'quote'; children: MdBlock[] }
  | { type: 'list'; ordered: boolean; start?: number; items: MdListItem[] }
  | { type: 'table'; align: MdTableAlign[]; rows: MdInline[][][] }
  | { type: 'hr' };

const ALLOWED_PROTOCOLS = new Set(['http:', 'https:', 'mailto:']);

/**
 * The URL only when its scheme is safe (`http:`, `https:`, `mailto:`). A
 * relative link or another scheme (`javascript:`, `data:`, `vbscript:`)
 * returns `undefined`, so the label stays plain text.
 */
export function safeMarkdownUrl(url: string): string | undefined {
  const parsed = parseUrl(url);
  if (parsed === undefined) {
    return undefined;
  }
  return ALLOWED_PROTOCOLS.has(parsed.protocol) ? url : undefined;
}

/** The subset of an mdast node this mapper reads, without depending on `mdast`. */
interface MdastNode {
  type: string;
  value?: string;
  depth?: number;
  lang?: string | null;
  ordered?: boolean | null;
  start?: number | null;
  checked?: boolean | null;
  align?: (string | null)[] | null;
  url?: string;
  alt?: string | null;
  children?: MdastNode[];
}

function textOf(node: MdastNode): string {
  if (node.alt !== null && node.alt !== undefined) {
    return node.alt;
  }
  if (typeof node.value === 'string') {
    return node.value;
  }
  return (node.children ?? []).map(textOf).join('');
}

function mapInlines(nodes: MdastNode[] | undefined): MdInline[] {
  return (nodes ?? []).flatMap(mapInline);
}

function mapInline(node: MdastNode): MdInline[] {
  switch (node.type) {
    case 'text':
      return [{ type: 'text', value: node.value ?? '' }];
    case 'strong':
      return [{ type: 'strong', children: mapInlines(node.children) }];
    case 'emphasis':
      return [{ type: 'em', children: mapInlines(node.children) }];
    case 'delete':
      return [{ type: 'del', children: mapInlines(node.children) }];
    case 'inlineCode':
      return [{ type: 'code', value: node.value ?? '' }];
    case 'link': {
      const children = mapInlines(node.children);
      if (node.url === undefined) {
        return children;
      }
      const href = safeMarkdownUrl(node.url);
      return href === undefined ? children : [{ type: 'link', href, children }];
    }
    case 'image':
    case 'imageReference':
      return node.alt ? [{ type: 'text', value: node.alt }] : [];
    case 'break':
      return [{ type: 'break' }];
    case 'html':
      return [];
    default: {
      if (node.children !== undefined) {
        return mapInlines(node.children);
      }
      const text = textOf(node);
      return text === '' ? [] : [{ type: 'text', value: text }];
    }
  }
}

function mapBlocks(nodes: MdastNode[] | undefined): MdBlock[] {
  return (nodes ?? []).flatMap(mapBlock);
}

function mapListItem(node: MdastNode): MdListItem {
  const children = mapBlocks(node.children);
  return typeof node.checked === 'boolean' ? { checked: node.checked, children } : { children };
}

function headingLevel(depth: number | undefined): 1 | 2 | 3 | 4 | 5 | 6 {
  const level = Math.min(6, Math.max(1, depth ?? 1));
  return level as 1 | 2 | 3 | 4 | 5 | 6;
}

function mapTableAlign(align: (string | null)[] | null | undefined): MdTableAlign[] {
  return (align ?? []).map((value) =>
    value === 'left' || value === 'center' || value === 'right' ? value : null,
  );
}

function mapTableRows(node: MdastNode): MdInline[][][] {
  return (node.children ?? [])
    .filter((row) => row.type === 'tableRow')
    .map((row) => (row.children ?? []).map((cell) => mapInlines(cell.children)));
}

function mapBlock(node: MdastNode): MdBlock[] {
  switch (node.type) {
    case 'paragraph':
      return [{ type: 'paragraph', children: mapInlines(node.children) }];
    case 'heading':
      return [
        { type: 'heading', level: headingLevel(node.depth), children: mapInlines(node.children) },
      ];
    case 'code': {
      const value = node.value ?? '';
      return node.lang === null || node.lang === undefined
        ? [{ type: 'code', value }]
        : [{ type: 'code', lang: node.lang, value }];
    }
    case 'blockquote':
      return [{ type: 'quote', children: mapBlocks(node.children) }];
    case 'list': {
      const ordered = node.ordered === true;
      const start = ordered && typeof node.start === 'number' ? node.start : undefined;
      const items = (node.children ?? []).map(mapListItem);
      return [
        start === undefined
          ? { type: 'list', ordered, items }
          : { type: 'list', ordered, start, items },
      ];
    }
    case 'table':
      return [{ type: 'table', align: mapTableAlign(node.align), rows: mapTableRows(node) }];
    case 'thematicBreak':
      return [{ type: 'hr' }];
    case 'html':
    case 'definition':
      return [];
    default: {
      const text = textOf(node);
      return text === '' ? [] : [{ type: 'paragraph', children: [{ type: 'text', value: text }] }];
    }
  }
}

/**
 * Parses up to `MARKDOWN_INPUT_LIMIT` characters of a message into the safe
 * AST. A half-written AI draft, an empty string or malformed Markdown never
 * throws: a failed parse returns no blocks.
 */
export function parseMessageMarkdown(text: string): MdBlock[] {
  try {
    const root = fromMarkdown(text.slice(0, MARKDOWN_INPUT_LIMIT), {
      extensions: [gfm()],
      mdastExtensions: [gfmFromMarkdown()],
    }) as unknown as MdastNode;
    return mapBlocks(root.children);
  } catch {
    return [];
  }
}
