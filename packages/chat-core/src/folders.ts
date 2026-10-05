import type { ChatSummary } from './types';

export type FolderChatType = 'dm' | 'group' | 'channel' | 'ai';

export const FOLDER_ICONS = [
  'folder',
  'message-circle',
  'user',
  'users',
  'megaphone',
  'bot',
  'briefcase',
  'house',
  'star',
  'heart',
  'bookmark',
  'flag',
  'bell',
  'globe',
  'graduation-cap',
  'gamepad-2',
  'music',
  'camera',
  'shopping-bag',
  'plane',
  'coffee',
  'dumbbell',
  'code',
  'wallet',
] as const;

export type FolderIcon = (typeof FOLDER_ICONS)[number];

export interface ChatFolder {
  id: string;
  name: string;
  icon: FolderIcon;
  position: number;
  includeTypes: FolderChatType[];
  includeChats: string[];
  excludeChats: string[];
  excludeMuted: boolean;
  excludeRead: boolean;
}

export const FOLDER_NAME_MAX = 24;
export const FOLDERS_MAX = 20;
export const FOLDER_CHATS_MAX = 100;

export function chatFolderType(chat: ChatSummary): FolderChatType {
  if (chat.isAI || chat.kind === 'ai') return 'ai';
  if (chat.kind === 'dm') return 'dm';
  if (chat.kind === 'group' && chat.chatKind === 'channel') return 'channel';
  return 'group';
}

export function folderMatches(folder: ChatFolder, chat: ChatSummary): boolean {
  if (chat.archived) return false;
  if (folder.excludeChats.includes(chat.id)) return false;
  if (folder.excludeMuted && chat.muted) return false;
  if (folder.excludeRead && chat.unread === 0) return false;
  return (
    folder.includeChats.includes(chat.id) || folder.includeTypes.includes(chatFolderType(chat))
  );
}

export function folderUnreadTotal(
  folder: ChatFolder | 'all',
  chats: readonly ChatSummary[],
): number {
  return chats
    .filter((chat) => {
      if (chat.archived || chat.muted) return false;
      if (folder === 'all') return true;
      return folderMatches(folder, chat);
    })
    .reduce((total, chat) => total + chat.unread, 0);
}

export function sortFolders(folders: readonly ChatFolder[]): ChatFolder[] {
  return [...folders].sort(
    (a, b) => a.position - b.position || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  );
}

export function defaultFolders(): ChatFolder[] {
  return [
    {
      id: 'default-personal',
      name: 'Personal',
      icon: 'user',
      position: 0,
      includeTypes: ['dm'],
      includeChats: [],
      excludeChats: [],
      excludeMuted: false,
      excludeRead: false,
    },
    {
      id: 'default-ais',
      name: 'AIs',
      icon: 'bot',
      position: 1,
      includeTypes: ['ai'],
      includeChats: [],
      excludeChats: [],
      excludeMuted: false,
      excludeRead: false,
    },
  ];
}
