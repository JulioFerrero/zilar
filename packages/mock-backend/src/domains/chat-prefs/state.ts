import type { MockSeed } from '../../data';
import type { MockData } from '../../state';
import type { MockChatBackground, MockChatPref } from './tables';

/**
 * The chat-prefs table plus the per-user background default. Rows are cloned
 * from the seed, so a caller-supplied seed is never changed; every write
 * replaces the array or the object, never mutates in place.
 */
export function createChatPrefsState(seed: MockSeed): Partial<MockData> {
  let chatPrefs: MockChatPref[] = seed.chatPrefs.map((pref) => ({ ...pref }));
  let backgroundDefault: MockChatBackground = { ...seed.backgroundDefault };
  return {
    get chatPrefs(): readonly MockChatPref[] {
      return chatPrefs;
    },
    findChatPref(chatJid: string): MockChatPref | undefined {
      const key = chatJid.toLowerCase();
      return chatPrefs.find((pref) => pref.chatJid.toLowerCase() === key);
    },
    putChatPref(pref: MockChatPref): void {
      const key = pref.chatJid.toLowerCase();
      chatPrefs = chatPrefs.some((item) => item.chatJid.toLowerCase() === key)
        ? chatPrefs.map((item) => (item.chatJid.toLowerCase() === key ? pref : item))
        : [...chatPrefs, pref];
    },
    removeChatPref(chatJid: string): void {
      const key = chatJid.toLowerCase();
      chatPrefs = chatPrefs.filter((pref) => pref.chatJid.toLowerCase() !== key);
    },
    get backgroundDefault(): MockChatBackground {
      return backgroundDefault;
    },
    putBackgroundDefault(background: MockChatBackground): void {
      backgroundDefault = { ...background };
    },
  };
}
