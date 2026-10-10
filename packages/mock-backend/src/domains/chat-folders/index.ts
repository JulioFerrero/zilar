import { defineDomain } from '../domain';
import { handleChatFolders } from './routes';
import { createChatFoldersState } from './state';

export const chatFoldersDomain = defineDomain({
  name: 'chat-folders',
  createState: createChatFoldersState,
  routes: handleChatFolders,
});
