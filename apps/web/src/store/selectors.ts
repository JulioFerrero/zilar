import type { ChatSummary } from '@zilar/chat-core';
import { folderMatches } from '@zilar/chat-core';
import type { ChatFolder } from '@zilar/chat-core';
import type { ChatStoreState } from './store';

/** True when the chat belongs to the active folder: `undefined` (unknown id)
 * and `'all'` both match everything, like the old hard-coded All tab. */
export function matchesFolder(chat: ChatSummary, folder: ChatFolder | undefined): boolean {
  if (folder === undefined) {
    return true;
  }
  return folderMatches(folder, chat);
}

export function activeFolderOf(state: ChatStoreState): ChatFolder | undefined {
  if (state.activeFolder === 'all') {
    return undefined;
  }
  return state.folders.find((folder) => folder.id === state.activeFolder);
}

export function visibleChats(state: ChatStoreState): ChatSummary[] {
  const query = state.search.trim().toLowerCase();
  // Unused by the list itself (it renders `groupChats`), but kept for callers
  // that need the flat visible rows: per-user archived DMs/AIs are out (they
  // live in the Archived list); topics stay, grouped or filtered by search.
  return state.chats.filter((chat) => {
    if (chat.topic === undefined && chat.archived === true) {
      return false;
    }
    if (!matchesFolder(chat, activeFolderOf(state))) {
      return false;
    }
    return (
      query.length === 0 ||
      chat.title.toLowerCase().includes(query) ||
      (chat.groupTitle !== undefined && chat.groupTitle.toLowerCase().includes(query))
    );
  });
}
