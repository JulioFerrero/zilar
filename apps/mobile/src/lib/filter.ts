import {
  folderMatches,
  folderUnreadTotal,
  type ChatFolder,
  type ChatSummary,
} from '@zilar/chat-core';

/**
 * `undefined` means the All tab; matching comes from chat-core's shared matcher.
 */

export function unreadCount(chats: readonly ChatSummary[], folder: ChatFolder | undefined): number {
  // Muted chats keep their grey badge but never count towards a tab total, so the badge matches the rows shown.
  return folderUnreadTotal(folder ?? 'all', chats);
}

export function filterChats(
  chats: readonly ChatSummary[],
  options: { folder: ChatFolder | undefined; search: string },
): ChatSummary[] {
  const query = options.search.trim().toLowerCase();
  return chats.filter(
    (chat) =>
      (options.folder === undefined || folderMatches(options.folder, chat)) &&
      (query === '' ||
        chat.title.toLowerCase().includes(query) ||
        chat.groupTitle?.toLowerCase().includes(query) === true),
  );
}
