import type { ChatPref } from '../lib/chat-prefs-api';

/**
 * The in-memory chat preferences of mock mode (T-0135): the mock store
 * works without a server, so prefs live here exactly like the web mock's
 * `chat_prefs` table. Seeded quiet (no muted/archived/pinned rows) so the
 * list reads as today until the user changes something.
 */

function seed(): ChatPref[] {
  return [];
}

let prefs: ChatPref[] = seed();

/** Resets the mock prefs, so tests start from the same seeded state. */
export function resetMockChatPrefs(): void {
  prefs = seed();
}

export function mockListChatPrefs(): ChatPref[] {
  return prefs.map((pref) => ({ ...pref }));
}

/**
 * Applies a partial pref update like the server: `pinned: true` stamps
 * now, `pinned: false`/expired mutes/unarchive clear back to defaults, and
 * a row back at all defaults is deleted, not kept (the caller drops it).
 */
export function mockPutChatPref(
  chatJid: string,
  input: {
    mutedUntil?: string | null | undefined;
    archived?: boolean | undefined;
    pinned?: boolean | undefined;
  },
  now: Date = new Date(),
): ChatPref | null {
  const key = chatJid.toLowerCase();
  const existing = prefs.find((pref) => pref.chatJid.toLowerCase() === key);
  const mutedUntil =
    input.mutedUntil === undefined ? (existing?.mutedUntil ?? null) : input.mutedUntil;
  const archived = input.archived === undefined ? (existing?.archived ?? false) : input.archived;
  const pinnedAt =
    input.pinned === undefined
      ? (existing?.pinnedAt ?? null)
      : input.pinned
        ? now.toISOString()
        : null;
  if (mutedUntil === null && !archived && pinnedAt === null) {
    prefs = prefs.filter((pref) => pref.chatJid.toLowerCase() !== key);
    return null;
  }
  const row: ChatPref = {
    chatJid,
    mutedUntil,
    archived,
    pinnedAt,
    updatedAt: now.toISOString(),
  };
  prefs =
    existing === undefined
      ? [...prefs, row]
      : prefs.map((pref) => (pref.chatJid.toLowerCase() === key ? row : pref));
  return row;
}
