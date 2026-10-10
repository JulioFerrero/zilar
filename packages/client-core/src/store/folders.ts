// Chat folders, shared by both stores: the server list is sorted by position
// and the active folder resets to 'all' when it disappears. The state names
// (`folders`, `activeFolder`) are the same on web and mobile, but the two
// stores expose them through different writers, so the logic takes a small
// adapter instead of a state extension.
import { sortFolders, type ChatFolder } from '@zilar/chat-core';

/** The sorted folders and the active id reconciled against them. */
export interface FoldersPatch {
  readonly folders: ChatFolder[];
  readonly activeFolder: string;
}

/** The folder slice of one store: how to read the active id and write the list. */
export interface FoldersAccess {
  activeFolder(): string;
  commit(patch: FoldersPatch): void;
}

/**
 * The folder patch for a new list: sorted by position, with the active id kept
 * while it still exists and reset to 'all' once it is gone.
 */
export function foldersAfterSet(
  activeFolder: string,
  folders: readonly ChatFolder[],
): FoldersPatch {
  const sorted = sortFolders(folders);
  return {
    folders: sorted,
    activeFolder:
      activeFolder === 'all' || sorted.some((folder) => folder.id === activeFolder)
        ? activeFolder
        : 'all',
  };
}

/** Applies a new folder list to a store: sorts it and reconciles the active id. */
export function setFolders(access: FoldersAccess, folders: readonly ChatFolder[]): void {
  access.commit(foldersAfterSet(access.activeFolder(), folders));
}
