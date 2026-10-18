import type { ChatSummary, UiMessage } from './types';
import { isAiJid } from './ai';

// Incoming messages in AI chats qualify, as do incoming AI replies in a group; a human DM, a human group message or your own message stays plain text.
export function shouldRenderMarkdown(
  chat: ChatSummary,
  message: UiMessage,
  currentUserId: string,
): boolean {
  if (message.senderId === currentUserId) {
    return false;
  }
  if (chat.isAI) {
    return true;
  }
  return chat.kind === 'group' && isAiJid(message.senderId);
}

const CODE_FENCE = /^\s*(```|~~~)/;
const HEADING = /^\s*#{1,6}\s+/;
const BLOCKQUOTE = /^\s*>\s?/;
const LIST_MARKER = /^\s*(?:[-*+]|\d{1,9}[.)])\s+/;
const HORIZONTAL_RULE = /^\s*(?:[-*_]\s*){3,}$/;

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

// Drops heading, quote, list and emphasis markers and link URLs, but keeps link text and code content, for the chat list preview.
export function markdownToPlain(text: string): string {
  const lines: string[] = [];
  let fence: string | undefined;

  for (const raw of text.split(/\r?\n/)) {
    const fenceMatch = CODE_FENCE.exec(raw);
    if (fenceMatch !== null) {
      fence = fence === undefined ? (fenceMatch[1] ?? '```') : undefined;
      continue;
    }
    if (fence !== undefined) {
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
