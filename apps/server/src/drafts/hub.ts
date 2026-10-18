import { Effect, Fiber } from 'effect';
import type { DraftEvent, DraftHubEvent } from './events';

// At most one `draft` per turn this often; the latest text is flushed before `end`.
export const DRAFT_THROTTLE_MS = 150;

// Past this many characters drafts stop; the final message still goes through XMPP
// uncut, so the cap only keeps the live channel small.
export const DRAFT_MAX_CHARS = 8000;

export type DraftListener = (event: DraftHubEvent) => void;

export interface DraftTurnPublisher {
  push(text: string): void;
  flush(text: string): void;
  end(outcome: 'sent' | 'failed'): void;
}

export interface DraftHub {
  publish(ownerUserId: string, event: DraftHubEvent): void;
  subscribe(ownerUserId: string, listener: DraftListener): () => void;
  listenerCount(ownerUserId: string): number;
  publishTurn(ownerUserId: string, chatJid: string, turnId: string): DraftTurnPublisher;
}

// In-process, per server: a user only ever receives drafts of AIs they own, with no
// cross-server fan-out. The latest `draft` of each open turn is replayed to a client
// that connects mid-turn, and cleared when the turn ends.
export function createDraftHub(): DraftHub {
  const listeners = new Map<string, Set<DraftListener>>();
  const latestDrafts = new Map<string, Map<string, DraftEvent>>();

  function remember(ownerUserId: string, event: DraftEvent): void {
    let byChat = latestDrafts.get(ownerUserId);
    if (byChat === undefined) {
      byChat = new Map();
      latestDrafts.set(ownerUserId, byChat);
    }
    byChat.set(event.chatJid, event);
  }

  function forget(ownerUserId: string, chatJid: string): void {
    const byChat = latestDrafts.get(ownerUserId);
    if (byChat === undefined) {
      return;
    }
    byChat.delete(chatJid);
    if (byChat.size === 0) {
      latestDrafts.delete(ownerUserId);
    }
  }

  function publish(ownerUserId: string, event: DraftHubEvent): void {
    if (event.type === 'draft') {
      remember(ownerUserId, event);
    } else {
      forget(ownerUserId, event.chatJid);
    }
    for (const listener of listeners.get(ownerUserId) ?? []) {
      listener(event);
    }
  }

  const hub: DraftHub = {
    publish,

    subscribe(ownerUserId: string, listener: DraftListener): () => void {
      let set = listeners.get(ownerUserId);
      if (set === undefined) {
        set = new Set();
        listeners.set(ownerUserId, set);
      }
      // Replay open turns before any live one: the listener is added first, so a live
      // `publish` cannot slip past the synchronous replay.
      set.add(listener);
      for (const event of latestDrafts.get(ownerUserId)?.values() ?? []) {
        listener(event);
      }
      return () => {
        const current = listeners.get(ownerUserId);
        if (current === undefined) {
          return;
        }
        current.delete(listener);
        if (current.size === 0) {
          listeners.delete(ownerUserId);
        }
      };
    },

    listenerCount(ownerUserId: string): number {
      return listeners.get(ownerUserId)?.size ?? 0;
    },

    publishTurn(ownerUserId: string, chatJid: string, turnId: string): DraftTurnPublisher {
      let latest: string | undefined;
      let latestSent: string | undefined;
      let lastSentAt = 0;
      let timer: Fiber.Fiber<void> | undefined;
      let ended = false;

      const flushLatest = (): void => {
        timer = undefined;
        if (latest === undefined || latest === latestSent) {
          return;
        }
        if (latest.length > DRAFT_MAX_CHARS) {
          return;
        }
        latestSent = latest;
        lastSentAt = Date.now();
        publish(ownerUserId, { type: 'draft', chatJid, turnId, text: latest });
      };

      const cancelTimer = (): void => {
        if (timer !== undefined) {
          Effect.runSync(Fiber.interrupt(timer));
          timer = undefined;
        }
      };

      return {
        push(text: string): void {
          if (ended) {
            return;
          }
          latest = text;
          if (text.length > DRAFT_MAX_CHARS || text === latestSent) {
            return;
          }
          if (timer !== undefined) {
            return;
          }
          // The first draft of a quiet turn goes out immediately; a burst schedules one
          // flush with the latest text.
          if (Date.now() - lastSentAt >= DRAFT_THROTTLE_MS) {
            flushLatest();
          } else {
            timer = Effect.runFork(
              Effect.sleep(DRAFT_THROTTLE_MS - (Date.now() - lastSentAt)).pipe(
                Effect.andThen(Effect.sync(flushLatest)),
              ),
            );
          }
        },

        flush(text: string): void {
          if (ended || text.length > DRAFT_MAX_CHARS) {
            return;
          }
          cancelTimer();
          latest = text;
          flushLatest();
        },

        end(outcome: 'sent' | 'failed'): void {
          if (ended) {
            return;
          }
          ended = true;
          cancelTimer();
          flushLatest();
          publish(ownerUserId, { type: 'end', chatJid, turnId, outcome });
        },
      };
    },
  };

  return hub;
}

export const sharedDraftHub: DraftHub = createDraftHub();
