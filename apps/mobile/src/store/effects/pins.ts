import { Effect } from 'effect';
import {
  loadPins as loadPinsCore,
  pinMessage as pinMessageCore,
  sanitizeMediaItems,
  unpinMessage as unpinMessageCore,
  type PinsStore,
} from '@zilar/client-core/store';

import { API_URL } from '../../lib/auth';
import { isTrustedMediaUrl } from '../../lib/attachments';
import type { Pin } from '../../lib/pins-api';
import type { ChatStoreState } from '../types';
import { Ports } from './ports';
import { lift, type StoreCtx } from './runtime';

// One shared empty list: a selector must return the same reference while
// nothing changed, or React re-renders forever ("Maximum update depth").
const EMPTY_PINS: Pin[] = [];

/**
 * Resolves a server-relative media URL (`/api/media/<id>`) against the API
 * origin, like the attachments store does (AGENTS pitfall: server URLs may
 * be relative on native). An absolute URL is left untouched.
 */
function resolveMediaUrl(url: string, apiUrl: string): string {
  if (!url.startsWith('/') || url.startsWith('//')) {
    return url;
  }
  return `${apiUrl.replace(/\/+$/, '')}${url}`;
}

export type PinActions = Pick<
  ChatStoreState,
  | 'pins'
  | 'refreshPins'
  | 'seedCachedPins'
  | 'pinFor'
  | 'canPin'
  | 'pinMessage'
  | 'unpinMessage'
  | 'dismissPinsError'
  | 'loadChatMedia'
>;

export interface Pins {
  readonly actions: PinActions;
  /** Loads the pins of a chat; a failure shows `pinsError` only when `loud`. */
  loadPins(chatId: string, loud: boolean): Effect.Effect<void, never, Ports>;
  /** Drops every pin of the session, so the next user starts empty (T-1916). */
  clear(): void;
}

/** Pins (T-0135) and the media panel (T-0436); the pin logic is the core's. */
export function makePins(ctx: StoreCtx): Pins {
  const { ports, get, set, s } = ctx;
  const { pins: pinsApi, media: mediaApi } = ports;

  // Pins by chat id (T-0135), newest first. Each publish bumps the chat's
  // revision once, so `pins(chatId)` selectors re-fire exactly once.
  const pinsByChat = new Map<string, Pin[]>();
  const pinsRevisionByChat = new Map<string, number>();
  let pinsRevision = 0;
  // T-1916: bumped by `clear()`. User loads run detached from the session
  // scope, so a response that lands after sign-out would republish the previous
  // user's pins; a load carries the epoch it started in and drops its result
  // when the epoch moved on.
  let pinsEpoch = 0;

  // Publishes one chat's pins and bumps its revision. A successful load or
  // pin/unpin clears the chat's inline error; the core sets the errors.
  function publishPins(chatId: string, pins: readonly Pin[]): void {
    pinsByChat.set(chatId, [...pins]);
    pinsRevision += 1;
    pinsRevisionByChat.set(chatId, pinsRevision);
    set((state) => ({
      pinsError: state.pinsError?.chatId === chatId ? undefined : state.pinsError,
    }));
  }

  const store: PinsStore = {
    pins: (chatId) => pinsByChat.get(chatId) ?? EMPTY_PINS,
    publish: publishPins,
    markReady: () => {},
    setError: (error) => set({ pinsError: error }),
    currentUserId: () => get().me?.id ?? get().currentUserId,
  };

  // A failure surfaces as `pinsError` for an explicit load and stays silent
  // on the background tick (the next tick retries). The store pins the epoch
  // of the call, so a stale answer writes nothing after `clear()`.
  const loadPins = (chatId: string, loud: boolean): Effect.Effect<void, never, Ports> =>
    loadPinsCore(ctx.coreCtx, pinsApi, storeAt(pinsEpoch), chatId, loud);

  // The pins core reads and writes through this store; `publish` and `setError`
  // are dropped when the call belongs to a session that has since signed out.
  function storeAt(atEpoch: number): PinsStore {
    return {
      ...store,
      publish: (chatId, pins) => {
        if (atEpoch === pinsEpoch) {
          publishPins(chatId, pins);
        }
      },
      setError: (error) => {
        if (atEpoch === pinsEpoch) {
          set({ pinsError: error });
        }
      },
    };
  }

  // Whether the viewer may pin in a chat: either side of a DM; for topics
  // a group owner/admin whose detail has loaded (roles ride `getGroup`).
  // The topic-creator edge is server-enforced only, like on web.
  function canPinIn(chatId: string): boolean {
    const state = get();
    const chat = state.chats.find((entry) => entry.id === chatId);
    if (chat === undefined) {
      return false;
    }
    if (chat.kind === 'dm') {
      return true;
    }
    if (chat.topic === undefined || chat.groupId === undefined) {
      return false;
    }
    const detail = s.groupDetails.get(chat.groupId);
    const meId = state.me?.id ?? state.currentUserId;
    const role = detail?.members.find((member) => member.userId === meId)?.role;
    return role === 'owner' || role === 'admin';
  }

  const actions: PinActions = {
    pins: (chatId) => {
      // Reading the revision subscribes the selector to pin publishes
      // for this chat, like `groupDetail` does with its own revision.
      void (pinsRevisionByChat.get(chatId) ?? 0);
      return pinsByChat.get(chatId) ?? EMPTY_PINS;
    },
    refreshPins: (chatId) => ctx.run(loadPins(chatId, true)),
    // T-1914: paint the cached pins of a cold start before the pins answer.
    // A chat that already has pins keeps them; the normal load replaces both.
    seedCachedPins: (cached) => {
      for (const [chatId, list] of Object.entries(cached)) {
        if (list.length === 0 || pinsByChat.has(chatId)) {
          continue;
        }
        publishPins(chatId, list);
      }
    },
    pinFor: (chatId, messageId) =>
      pinsByChat.get(chatId)?.find((pin) => pin.messageId === messageId),
    canPin: (chatId) => canPinIn(chatId),
    pinMessage: (chatId, messageId) =>
      ctx.run(
        Effect.gen(function* () {
          if (!canPinIn(chatId)) {
            return yield* Effect.fail(new Error('You cannot pin here.'));
          }
          yield* pinMessageCore(ctx.coreCtx, pinsApi, storeAt(pinsEpoch), chatId, messageId);
        }),
      ),
    unpinMessage: (chatId, pinId) =>
      ctx.run(unpinMessageCore(ctx.coreCtx, pinsApi, storeAt(pinsEpoch), chatId, pinId)),
    dismissPinsError: () => {
      set({ pinsError: undefined });
    },
    loadChatMedia: (chatId, tab, before) =>
      ctx.run(
        Effect.gen(function* () {
          const page = yield* lift(() =>
            mediaApi.listChatMedia({
              chat: chatId,
              type: tab,
              ...(before === undefined ? {} : { before }),
            }),
          );
          return {
            items: sanitizeMediaItems(
              page.items,
              (url) => isTrustedMediaUrl(url, s.mediaTrustedHosts),
              (url) => resolveMediaUrl(url, API_URL),
            ),
            next: page.next,
          };
        }),
      ),
  };

  // T-1916: sign-out drops the per-chat pins, so the next user on the same
  // install never sees the previous user's pins (a DM's chat id is the peer's
  // JID). The bump also invalidates a load or pin call still in flight. This
  // writes no state: the caller must follow with a `set()` for selectors to
  // re-fire (teardown resets the user state right after).
  function clear(): void {
    pinsEpoch += 1;
    pinsByChat.clear();
    pinsRevisionByChat.clear();
  }

  return { actions, loadPins, clear };
}
