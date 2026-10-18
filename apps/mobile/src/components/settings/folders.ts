import {
  FOLDER_NAME_MAX,
  type ChatFolder,
  type FolderChatType,
  type FolderIcon,
} from '@zilar/chat-core';

import type { CreateChatFolderInput } from '@/lib/chat-folders-api';

/**
 * The pure pieces of the mobile folder settings: the summary line and the
 * create/patch body. Kept hook- and JSX-free so Vitest covers them without a
 * simulator.
 */

export const FOLDER_TYPE_LABELS: Record<FolderChatType, string> = {
  dm: 'Personal chats',
  group: 'Groups',
  channel: 'Channels',
  ai: 'AIs',
};

export interface FolderForm {
  name: string;
  icon: FolderIcon;
  includeTypes: FolderChatType[];
  excludeMuted: boolean;
  excludeRead: boolean;
}

export function folderSummary(folder: ChatFolder): string {
  const typePart = folder.includeTypes.map((type) => FOLDER_TYPE_LABELS[type]).join(', ');
  const count = folder.includeChats.length;
  if (typePart === '' && count === 0) {
    return 'No rules yet';
  }
  if (count === 0) {
    return typePart;
  }
  const chatPart = count === 1 ? '1 chat' : `${count} chats`;
  if (typePart === '') {
    return chatPart;
  }
  return `${typePart}, ${chatPart}`;
}

export type FolderEditorState = 'new' | 'loading' | 'missing' | 'ready';

export function editorState(
  id: string | undefined,
  folder: ChatFolder | undefined,
  foldersLoaded: boolean,
): FolderEditorState {
  if (id === undefined || id === 'new') {
    return 'new';
  }
  if (folder !== undefined) {
    return 'ready';
  }
  return foldersLoaded ? 'missing' : 'loading';
}

export function isFolderNameValid(name: string): boolean {
  const trimmed = name.trim();
  return trimmed.length >= 1 && trimmed.length <= FOLDER_NAME_MAX;
}

/**
 * The body a create or patch sends. The chat lists are omitted on purpose: the
 * editor never touches them, and the server keeps the existing ones.
 */
export function folderInput(form: FolderForm): CreateChatFolderInput {
  return {
    name: form.name.trim(),
    icon: form.icon,
    includeTypes: form.includeTypes,
    excludeMuted: form.excludeMuted,
    excludeRead: form.excludeRead,
  };
}
