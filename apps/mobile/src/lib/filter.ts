import type { ChatFolder, ChatSummary } from './types';

export const CHAT_FOLDERS: { key: ChatFolder; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'personal', label: 'Personal' },
  { key: 'ai', label: 'AIs' },
  { key: 'work', label: 'Work' },
];

export function inFolder(chat: ChatSummary, folder: ChatFolder): boolean {
  switch (folder) {
    case 'all':
      return true;
    case 'personal':
      return chat.space === 'personal' && !chat.isAI;
    case 'ai':
      return chat.isAI;
    case 'work':
      return chat.space === 'work';
  }
}

export function unreadCount(chats: readonly ChatSummary[], folder: ChatFolder): number {
  return chats
    .filter((chat) => inFolder(chat, folder))
    .reduce((total, chat) => total + chat.unread, 0);
}

export function filterChats(
  chats: readonly ChatSummary[],
  options: { folder: ChatFolder; search: string },
): ChatSummary[] {
  const query = options.search.trim().toLowerCase();
  return chats.filter(
    (chat) =>
      inFolder(chat, options.folder) && (query === '' || chat.title.toLowerCase().includes(query)),
  );
}
