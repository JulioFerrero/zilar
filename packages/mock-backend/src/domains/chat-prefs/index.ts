import { defineDomain } from '../domain';
import { handleChatPrefs } from './routes';
import { seedChatPrefsTable } from './seed';
import { createChatPrefsState } from './state';

export const chatPrefsDomain = defineDomain({
  name: 'chat-prefs',
  seed: seedChatPrefsTable,
  createState: createChatPrefsState,
  routes: handleChatPrefs,
});
