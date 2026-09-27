import type { UiMessage } from './types';

export const GROUP_WINDOW_MS = 5 * 60 * 1000;

export type MessageListItem = {
  type: 'message';
  key: string;
  message: UiMessage;
  isFirstInGroup: boolean;
  isLastInGroup: boolean;
};

export type DateSeparatorItem = {
  type: 'date';
  key: string;
  iso: string;
};

export type ChatListItem = MessageListItem | DateSeparatorItem;

function dayKey(iso: string): string {
  const date = new Date(iso);
  return `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`;
}

type Group = {
  senderId: string;
  day: string;
  messages: UiMessage[];
};

function toGroups(messages: readonly UiMessage[]): Group[] {
  const groups: Group[] = [];
  for (const message of messages) {
    const day = dayKey(message.createdAt);
    const previous = groups.at(-1);
    const previousMessage = previous?.messages.at(-1);
    const sameSender = previousMessage?.senderId === message.senderId;
    const withinWindow =
      previousMessage !== undefined &&
      new Date(message.createdAt).getTime() - new Date(previousMessage.createdAt).getTime() <=
        GROUP_WINDOW_MS;
    if (previous && previous.day === day && sameSender && withinWindow) {
      previous.messages.push(message);
    } else {
      groups.push({ senderId: message.senderId, day, messages: [message] });
    }
  }
  return groups;
}

/**
 * Sorts messages by time, groups consecutive messages from the same sender
 * within 5 minutes, and inserts a date separator before each new day.
 */
export function groupMessages(messages: readonly UiMessage[]): ChatListItem[] {
  const sorted = [...messages].sort(
    (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
  );
  const items: ChatListItem[] = [];
  let currentDay: string | undefined;
  for (const group of toGroups(sorted)) {
    if (group.day !== currentDay) {
      items.push({ type: 'date', key: `date:${group.day}`, iso: group.messages[0].createdAt });
      currentDay = group.day;
    }
    group.messages.forEach((message, index) => {
      items.push({
        type: 'message',
        key: message.id,
        message,
        isFirstInGroup: index === 0,
        isLastInGroup: index === group.messages.length - 1,
      });
    });
  }
  return items;
}
