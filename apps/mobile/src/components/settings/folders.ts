import {
  FOLDER_NAME_MAX,
  type ChatFolder,
  type FolderChatType,
  type FolderIcon,
} from '@zilar/chat-core';

import type { CreateChatFolderInput } from '@/lib/chat-folders-api';

/**
 * The pure pieces of the mobile folder settings (T-0255): the summary line the
 * list shows and the create/patch body the editor builds. Kept hook- and
 * JSX-free so Vitest covers them without a simulator.
 */

/** The web editor's type labels, in the order the switches render them. */
export const FOLDER_TYPE_LABELS: Record<FolderChatType, string> = {
  dm: 'Personal chats',
  group: 'Groups',
  channel: 'Channels',
  ai: 'AIs',
};

/** The editor's form state, before it becomes a create or patch body. */
export interface FolderForm {
  name: string;
  icon: FolderIcon;
  includeTypes: FolderChatType[];
  excludeMuted: boolean;
  excludeRead: boolean;
}

/** The list's one-line summary: the selected types or "No chat types". */
export function folderSummary(folder: ChatFolder): string {
  const labels = folder.includeTypes.map((type) => FOLDER_TYPE_LABELS[type]);
  return labels.length === 0 ? 'No chat types' : labels.join(', ');
}

/**
 * What the folder editor shows for a route id (T-0262): `new` for the create
 * route, `ready` once an existing folder is in the store, `loading` while the
 * folders have not synced yet, and `missing` once they have and the id is
 * still absent.
 */
export type FolderEditorState = 'new' | 'loading' | 'missing' | 'ready';

/**
 * Decides the editor view from the route id, the store's folder and whether
 * the folders have synced. Pure, so Vitest covers it without a simulator.
 */
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

/** Save is enabled for a non-blank, at-most-max name. */
export function isFolderNameValid(name: string): boolean {
  const trimmed = name.trim();
  return trimmed.length >= 1 && trimmed.length <= FOLDER_NAME_MAX;
}

/**
 * The body a create or patch sends. The chat lists are omitted on purpose:
 * the editor never touches them, and the server keeps the existing ones.
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
