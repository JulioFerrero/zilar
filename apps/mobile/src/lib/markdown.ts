/**
 * A small, dependency-free Markdown parser for the mobile app, the counterpart
 * of the web's `react-markdown` safe subset (T-0049). It is pure and total: any
 * input, including a half-written AI draft, produces blocks without throwing.
 *
 * This module is now a barrel: inline parsing lives in `markdown-inline.ts` and
 * block parsing in `markdown-blocks.ts`. Split out by T-1040; every name this
 * module exported before is still re-exported here.
 */

export { safeMarkdownUrl, parseInline } from './markdown-inline';
export type { InlineNode, ListItem, Block } from './markdown-inline';

export { parseMarkdown } from './markdown-blocks';
