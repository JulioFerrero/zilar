import { defineDomain } from '../domain';
import { seedMessages } from './seed';
import { createMessagesState } from './state';

/** Messages have no route of their own yet; search reads their table. */
export const messagesDomain = defineDomain({
  name: 'messages',
  seed: seedMessages,
  createState: createMessagesState,
});
