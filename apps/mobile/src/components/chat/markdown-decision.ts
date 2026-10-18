import {
  lightToPlain,
  markdownToPlain,
  shouldRenderMarkdown,
  type ChatSummary,
  type UiMessage,
} from '@zilar/chat-core';

// The two Markdown wiring decisions, kept pure and unit-tested; both delegate to the shared `shouldRenderMarkdown` rule, so phone and web cannot disagree about what counts as an AI reply.

// Whether a bubble renders Markdown instead of `LinkText`; an unknown chat stays plain, so a chat the store has not loaded never renders Markdown.
export function rendersMarkdown(
  chats: readonly ChatSummary[],
  message: UiMessage,
  currentUserId: string,
): boolean {
  const chat = chats.find((item) => item.id === message.chatId);
  return chat !== undefined && shouldRenderMarkdown(chat, message, currentUserId);
}

// The chat-list preview: an incoming AI reply is flattened to one plain line; a human message or your own in an AI chat shows its light Markdown markers stripped.
export function plainPreviewBody(
  chat: ChatSummary,
  last: UiMessage | undefined,
  rawBody: string,
  currentUserId: string,
): string {
  return last !== undefined && shouldRenderMarkdown(chat, last, currentUserId)
    ? markdownToPlain(rawBody)
    : lightToPlain(rawBody);
}
