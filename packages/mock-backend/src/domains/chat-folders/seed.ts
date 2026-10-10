// The chat-folders seed (T-1045): two starting folders, ported from web's
// `seedChatFolders` (`apps/web/src/mock/api.ts:200`). Rows use the contract's
// `ChatFolder` shape (`@zilar/api-contract`, `chat-folders.ts`).
import type { FolderChatType, FolderIcon } from '@zilar/api-contract';

/** One folder row, the live shape `GET /chat-folders` returns. */
export interface MockChatFolder {
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

/** Personal (every DM) and AIs (every AI chat), like the old web mock. */
export function seedChatFolders(): readonly MockChatFolder[] {
  return [
    {
      id: 'mock-folder-personal',
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
      id: 'mock-folder-ais',
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
