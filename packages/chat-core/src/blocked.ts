import type { ChatSummary, UiMessage } from './types';

/** The localpart of a JID, lowercased (`Bob@zilar.test` becomes `bob`). */
export function localpartOf(value: string): string {
  const at = value.indexOf('@');
  return (at === -1 ? value : value.slice(0, at)).toLowerCase();
}

/** Whether `senderId` belongs to a blocked person, ignoring case and domain. */
export function isBlockedSender(senderId: string, blocked: ReadonlySet<string>): boolean {
  return blocked.has(localpartOf(senderId));
}

/**
 * The message a chat or topic row should preview. In a group or channel the
 * last message is skipped when its sender is blocked, falling back to the
 * newest loaded message from anyone else (my own messages always count). A
 * missing candidate yields no preview. DMs and AI chats are never filtered.
 */
export function previewMessage(
  chat: ChatSummary,
  messages: readonly UiMessage[],
  blocked: ReadonlySet<string>,
  meId: string,
): UiMessage | undefined {
  const last = chat.lastMessage;
  if (chat.kind !== 'group' || chat.isAI === true) {
    return last;
  }
  if (last === undefined || last.senderId === meId || !isBlockedSender(last.senderId, blocked)) {
    return last;
  }
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (
      message !== undefined &&
      (message.senderId === meId || !isBlockedSender(message.senderId, blocked))
    ) {
      return message;
    }
  }
  return undefined;
}
