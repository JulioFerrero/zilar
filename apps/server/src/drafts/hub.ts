import type { DraftHubEvent } from './events';

// At most one `draft` per turn this often. The text is cumulative, so a
// dropped draft is harmless, and the latest text is always flushed before
// `end`.
export const DRAFT_THROTTLE_MS = 150;

// Drafts stop past this many characters. The final message still goes through
// XMPP uncut; the cap only keeps the live channel small.
export const DRAFT_MAX_CHARS = 8000;

export type DraftListener = (event: DraftHubEvent) => void;

// One turn's throttled writer. `push` records the cumulative text and
// publishes at most every `DRAFT_THROTTLE_MS`; `flush` publishes the given
// text now (the complete reply, right before the final XMPP send); `end`
// flushes the latest text (when it is new and within the cap) and then
// publishes the outcome. All are idempotent after `end`.
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

// In-process, per server: a user only ever receives drafts of AIs they own.
// There is no cross-server fan-out (one server per deployment for now) and no
// history: a client that connects mid-turn gets the next cumulative `draft`.
export function createDraftHub(): DraftHub {
  const listeners = new Map<string, Set<DraftListener>>();

  function publish(ownerUserId: string, event: DraftHubEvent): void {
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
      set.add(listener);
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
      let timer: ReturnType<typeof setTimeout> | undefined;
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
          // The first draft of a quiet turn goes out immediately; a burst
          // schedules one flush with the latest text. `flush` and `end` below
          // publish synchronously, so ordering with `end` stays exact.
          if (Date.now() - lastSentAt >= DRAFT_THROTTLE_MS) {
            flushLatest();
          } else {
            timer = setTimeout(flushLatest, DRAFT_THROTTLE_MS - (Date.now() - lastSentAt));
          }
        },

        flush(text: string): void {
          if (ended) {
            return;
          }
          if (timer !== undefined) {
            clearTimeout(timer);
            timer = undefined;
          }
          latest = text;
          flushLatest();
        },

        end(outcome: 'sent' | 'failed'): void {
          if (ended) {
            return;
          }
          ended = true;
          if (timer !== undefined) {
            clearTimeout(timer);
            timer = undefined;
          }
          flushLatest();
          publish(ownerUserId, { type: 'end', chatJid, turnId, outcome });
        },
      };
    },
  };

  return hub;
}

// The hub the server routes and the agent gateway share. Tests create their
// own with `createDraftHub()`; the gated live check relies on this shared one
// (the in-process gateway publishes here, the branch server streams from it).
export const sharedDraftHub: DraftHub = createDraftHub();
