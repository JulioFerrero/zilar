import {
  previewBody,
  previewKind,
  previewPrefix,
  type PreviewKind,
  type UiMessage,
} from '@zilar/chat-core';

export { formatLastSeen, replyRef, typingLabel } from '@zilar/chat-core';

export type PreviewOptions = {
  isGroup: boolean;
  currentUserId: string;
};

/**
 * Prefix, body and icon kind for the chat-list preview, kept apart so the
 * sender can be colored and the row can draw the right lucide icon before the
 * text. `previewPrefix` already includes its trailing space, so joining the
 * prefix and body yields the exact preview text (`Dani: ok!`).
 */
export function previewParts(
  lastMessage: UiMessage | undefined,
  options: PreviewOptions,
): { prefix: string; body: string; kind: PreviewKind | undefined } {
  return {
    prefix: previewPrefix(lastMessage, options),
    body: previewBody(lastMessage),
    kind: previewKind(lastMessage),
  };
}
