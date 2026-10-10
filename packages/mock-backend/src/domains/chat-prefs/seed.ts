// The chat-prefs seed (T-0113, T-0462): no rows and an unset background default,
// like web's mock, so the list reads as today until the user changes something.

import type { MockSeed } from '../../data';
import { DEFAULT_CHAT_BACKGROUND } from './tables';

export function seedChatPrefsTable(): Partial<MockSeed> {
  return {
    chatPrefs: [],
    backgroundDefault: { ...DEFAULT_CHAT_BACKGROUND },
  };
}
