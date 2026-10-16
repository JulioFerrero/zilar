import { formatTime, type UiMessage } from '@zilar/chat-core';

/**
 * The time text shown next to a message: `HH:mm`, prefixed with `edited ` when
 * the message was corrected. An edited message shows the latest correction's
 * time (`editedAt`) when the server sent one, else the original send time.
 */
export function metaTimeText(message: UiMessage): string {
  const edited = message.edited === true;
  const at = edited && message.editedAt !== undefined ? message.editedAt : message.createdAt;
  const time = formatTime(at);
  return edited ? `edited ${time}` : time;
}
