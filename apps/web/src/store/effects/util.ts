import { Effect } from 'effect';
import type { ChatPref } from '@/lib/api';

/** One Promise call as an Effect; a rejection (or a sync throw) keeps its value as the failure. */
export const fromPromise = <A>(thunk: () => Promise<A>): Effect.Effect<A, unknown> =>
  Effect.tryPromise({ try: () => thunk(), catch: (error) => error });

/** The prefs keyed by their lowercased chat JID. */
export function prefsByJid(prefs: readonly ChatPref[]): Record<string, ChatPref> {
  const byJid: Record<string, ChatPref> = {};
  for (const pref of prefs) {
    byJid[pref.chatJid.toLowerCase()] = pref;
  }
  return byJid;
}
