// The chat-prefs domain's tables. Like every domain it extends the shared
// `MockSeed`/`MockData` from its own folder (module augmentation), so a new
// domain is a folder plus one line in `src/domains/index.ts`.

import type { ChatBackgroundChoice, ChatPref } from '@zilar/api-contract';

/** One chat-preference row, mirroring the server's `chat_prefs`. */
export type MockChatPref = ChatPref;

/** The per-user background default (all null means unset). */
export type MockChatBackground = ChatBackgroundChoice;

export const DEFAULT_CHAT_BACKGROUND: MockChatBackground = {
  backgroundPreset: null,
  backgroundImageId: null,
  backgroundDim: null,
};

declare module '../../data' {
  interface MockSeed {
    readonly chatPrefs: readonly MockChatPref[];
    readonly backgroundDefault: MockChatBackground;
  }
}

declare module '../../state' {
  interface MockData {
    readonly chatPrefs: readonly MockChatPref[];
    findChatPref(chatJid: string): MockChatPref | undefined;
    /** Replace the row with the same JID, or append it when it is new. */
    putChatPref(pref: MockChatPref): void;
    removeChatPref(chatJid: string): void;
    readonly backgroundDefault: MockChatBackground;
    putBackgroundDefault(background: MockChatBackground): void;
  }
}
