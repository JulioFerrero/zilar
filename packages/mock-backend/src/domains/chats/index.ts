import { defineDomain } from '../domain';
import { handleChats } from './routes';
import { seedChats } from './seed';
import { createChatsState } from './state';

export const chatsDomain = defineDomain({
  name: 'chats',
  seed: seedChats,
  createState: createChatsState,
  routes: handleChats,
});
