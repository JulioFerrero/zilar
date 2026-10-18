import { formatTime, type UiMessage } from '@zilar/chat-core';

// The time next to a message: `HH:mm`, prefixed with `edited ` when corrected. An edited message shows `editedAt` when sent, else the original send time.
export function metaTimeText(message: UiMessage): string {
  const edited = message.edited === true;
  const at = edited && message.editedAt !== undefined ? message.editedAt : message.createdAt;
  const time = formatTime(at);
  return edited ? `edited ${time}` : time;
}
