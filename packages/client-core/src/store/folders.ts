// Chat folders shared by both stores; each store reads and writes them through a small
// adapter.
import { sortFolders, type ChatFolder } from '@zilar/chat-core';

export interface FoldersPatch {
  readonly folders: ChatFolder[];
  readonly activeFolder: string;
}

export interface FoldersAccess {
  activeFolder(): string;
  commit(patch: FoldersPatch): void;
}

/** The folder patch: sorted by position, active id kept while it exists, reset to 'all'
 * once it is gone. */
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

export function setFolders(access: FoldersAccess, folders: readonly ChatFolder[]): void {
  access.commit(foldersAfterSet(access.activeFolder(), folders));
}
