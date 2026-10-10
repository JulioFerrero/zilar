import { previewBody, previewPrefix, type UiMessage } from '@zilar/chat-core';

export { formatLastSeen, replyRef, typingLabel } from '@zilar/chat-core';

export type PreviewOptions = {
  isGroup: boolean;
  currentUserId: string;
};

/**
 * Prefix and body for the chat-list preview, kept apart so the sender can be
 * colored. `previewPrefix` already includes its trailing space, so joining the
 * two parts yields the exact preview text (`Dani: ok!`).
 */
export function previewParts(
  lastMessage: UiMessage | undefined,
  options: PreviewOptions,
): { prefix: string; body: string } {
  return { prefix: previewPrefix(lastMessage, options), body: previewBody(lastMessage) };
}
