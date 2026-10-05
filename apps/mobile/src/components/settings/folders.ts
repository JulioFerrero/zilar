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
