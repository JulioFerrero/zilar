import {
  markdownToPlain,
  shouldRenderMarkdown,
  type ChatSummary,
  type UiMessage,
} from '@galena/chat-core';

/**
 * The two Markdown wiring decisions, kept pure and next to the components so
 * they can be unit-tested: `MessageBubble` and `ChatListItem` only branch on the
 * result. Both delegate to the shared `shouldRenderMarkdown` rule, so the phone
 * and the web can never disagree about what counts as an AI reply.
 */

/**
 * Whether a message bubble renders its body as Markdown instead of `LinkText`.
 * The message's chat is looked up by `message.chatId`; an unknown chat stays
 * plain, so a chat the store has not loaded never renders Markdown.
 */
export function rendersMarkdown(
  chats: readonly ChatSummary[],
  message: UiMessage,
  currentUserId: string,
): boolean {
  const chat = chats.find((item) => item.id === message.chatId);
  return chat !== undefined && shouldRenderMarkdown(chat, message, currentUserId);
}

/**
 * The chat-list preview body: an incoming AI reply (a DM AI or a group AI
 * reply) is flattened to one plain line, while a human message or your own
 * message in an AI chat is returned as it is.
 */
export function plainPreviewBody(
  chat: ChatSummary,
  last: UiMessage | undefined,
  rawBody: string,
  currentUserId: string,
): string {
  return last !== undefined && shouldRenderMarkdown(chat, last, currentUserId)
    ? markdownToPlain(rawBody)
    : rawBody;
}
