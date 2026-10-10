import type { MockData } from '../../state';
import { seedChatFolders, type MockChatFolder } from './seed';

/**
 * The chat-folders table. Rows are cloned from the seed so a caller-supplied
 * seed is never changed; create, reorder, patch and delete replace the array.
 * `nextFolderSequence` mints the `folder-mock-N` ids.
 */
export function createChatFoldersState(): Partial<MockData> {
  const chatFolders: MockChatFolder[] = seedChatFolders().map((folder) => ({
    ...folder,
    includeTypes: [...folder.includeTypes],
    includeChats: [...folder.includeChats],
    excludeChats: [...folder.excludeChats],
  }));
  return { chatFolders, nextFolderSequence: chatFolders.length + 1 };
}
