import {
  folderMatches,
  folderUnreadTotal,
  type ChatFolder,
  type ChatSummary,
} from '@zilar/chat-core';

/**
 * The pure folder helpers (T-0248). Folders come from the server and match
 * through `chat-core`'s shared matcher; `undefined` means the All tab.
 */

export function unreadCount(chats: readonly ChatSummary[], folder: ChatFolder | undefined): number {
  // T-0135: muted chats keep their own grey badge but never count towards a
  // tab total. `folderUnreadTotal` skips muted chats (and archived ones), so
  // the badge stays consistent with the rows the folder shows.
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
