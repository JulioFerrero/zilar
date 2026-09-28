import type { ChatSummary, UiMessage } from './types';

/**
 * Whether a message's text is rendered as Markdown. Only incoming messages in
 * AI chats qualify: a human DM, a group, or your own message always stays
 * plain text, even when it contains `**`, `` ` `` or `#`.
 */
export function shouldRenderMarkdown(
  chat: ChatSummary,
  message: UiMessage,
  currentUserId: string,
): boolean {
  return chat.isAI && message.senderId !== currentUserId;
}

const CODE_FENCE = /^\s*(```|~~~)/;
const HEADING = /^\s*#{1,6}\s+/;
const BLOCKQUOTE = /^\s*>\s?/;
const LIST_MARKER = /^\s*(?:[-*+]|\d{1,9}[.)])\s+/;
const HORIZONTAL_RULE = /^\s*(?:[-*_]\s*){3,}$/;

/**
 * Drops the inline markers (links, images, code, emphasis, strike) while
 * keeping the words. An unmatched marker stays, so a lone `*` in `2 * 3` and a
 * partial `**bold` both survive.
 */
function stripInline(text: string): string {
  let out = text;
  out = out.replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1');
  out = out.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1');
  out = out.replace(/(`+)(.+?)\1/g, '$2');
  out = out.replace(/\*\*\*(?=\S)([\s\S]*?\S)\*\*\*/g, '$1');
  out = out.replace(/\*\*(?=\S)([\s\S]*?\S)\*\*/g, '$1');
  out = out.replace(/(?<![\w*])\*(?=\S)([^*\n]*?\S)\*(?![\w*])/g, '$1');
  out = out.replace(/___(?=\S)([\s\S]*?\S)___/g, '$1');
  out = out.replace(/__(?=\S)([\s\S]*?\S)__/g, '$1');
  out = out.replace(/(?<![\w])_(?=\S)([^_\n]*?\S)_(?![\w])/g, '$1');
  out = out.replace(/~~(?=\S)([\s\S]*?\S)~~/g, '$1');
  return out;
}

/**
 * Flattens a Markdown reply to one line of plain text, for the chat list
 * preview (and, later, mobile). It drops the heading `#`s, the quote and list
 * markers, the emphasis markers and the inline-code backticks, keeps link text
 * and code content, and drops link URLs. Pure, with no dependencies.
 */
export function markdownToPlain(text: string): string {
  const lines: string[] = [];
  let fence: string | undefined;

  for (const raw of text.split(/\r?\n/)) {
    const fenceMatch = CODE_FENCE.exec(raw);
    if (fenceMatch !== null) {
      // A fence opens or closes a code block; its own line is dropped.
      fence = fence === undefined ? (fenceMatch[1] ?? '```') : undefined;
      continue;
    }
    if (fence !== undefined) {
      // Code content is literal: keep it as it is.
      lines.push(raw);
      continue;
    }
    if (HORIZONTAL_RULE.test(raw)) {
      continue;
    }
    let line = raw;
    while (BLOCKQUOTE.test(line)) {
      line = line.replace(BLOCKQUOTE, '');
    }
    line = line.replace(HEADING, '');
    line = line.replace(LIST_MARKER, '');
    lines.push(stripInline(line));
  }

  return lines.join(' ').replace(/\s+/g, ' ').trim();
}
