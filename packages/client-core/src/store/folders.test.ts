import type { ChatFolder } from '@zilar/chat-core';
import { describe, expect, it, vi } from 'vitest';
import { foldersAfterSet, setFolders, type FoldersPatch } from './folders';

const folder = (id: string, position: number): ChatFolder => ({
  id,
  name: id,
  icon: 'folder',
  position,
  includeTypes: [],
  includeChats: [],
  excludeChats: [],
  excludeMuted: false,
  excludeRead: false,
});

describe('foldersAfterSet (core)', () => {
  it('sorts by position and resets a vanished active id to all', () => {
    expect(
      foldersAfterSet('all', [folder('b', 1), folder('a', 0)]).folders.map((f) => f.id),
    ).toEqual(['a', 'b']);
    expect(foldersAfterSet('b', [folder('a', 0)]).activeFolder).toBe('all');
  });

  it('keeps the active id while it still exists', () => {
    expect(foldersAfterSet('a', [folder('b', 1), folder('a', 0)]).activeFolder).toBe('a');
  });
});

describe('setFolders (core)', () => {
  it('commits the sorted list and the reconciled active id', () => {
    let active = 'gone';
    const commit = vi.fn((patch: FoldersPatch) => {
      active = patch.activeFolder;
    });
    setFolders({ activeFolder: () => active, commit }, [folder('a', 0)]);
    expect(commit).toHaveBeenCalledWith({ folders: [folder('a', 0)], activeFolder: 'all' });
  });
});
