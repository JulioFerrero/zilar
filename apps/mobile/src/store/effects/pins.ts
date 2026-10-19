import { Effect } from 'effect';
import {
  canPinFor,
  loadPins as loadPinsCore,
  pinMessage as pinMessageCore,
  sanitizeMediaItems,
  unpinMessage as unpinMessageCore,
  type PinsStore,
} from '@zilar/client-core/store';

import { API_URL } from '../../lib/auth';
import { isTrustedMediaUrl } from '@zilar/chat-core';
import type { Pin } from '@zilar/api-contract';
import type { ChatStoreState } from '../types';
import { Ports } from './ports';
import { lift, type StoreCtx } from './runtime';

// One shared empty list: a selector must return the same reference while nothing changed, or React re-renders forever ("Maximum update depth").
const EMPTY_PINS: Pin[] = [];

/** Resolves a server-relative media URL (`/api/media/<id>`) against the API origin; an absolute URL is left untouched. */
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
  loadPins(chatId: string, loud: boolean): Effect.Effect<void, never, Ports>;
  /** Drops every pin of the session, so the next user starts empty. */
  clear(): void;
}

export function makePins(ctx: StoreCtx): Pins {
  const { ports, get, set, s } = ctx;
  const { pins: pinsApi, media: mediaApi } = ports;

  // Pins by chat id, newest first. Each publish bumps the chat's revision once, so `pins(chatId)` selectors re-fire exactly once.
  const pinsByChat = new Map<string, Pin[]>();
  const pinsRevisionByChat = new Map<string, number>();
  let pinsRevision = 0;
  // Bumped by `clear()`: user loads run detached from the session scope, so a response landing after sign-out would republish the previous user's pins. A load drops its result when the epoch moved on.
  let pinsEpoch = 0;

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

  const loadPins = (chatId: string, loud: boolean): Effect.Effect<void, never, Ports> =>
    loadPinsCore(ctx.coreCtx, pinsApi, storeAt(pinsEpoch), chatId, loud);

  // `publish` and `setError` are dropped when the call belongs to a session that has since signed out.
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

  function canPinIn(chatId: string): boolean {
    const state = get();
    const chat = state.chats.find((entry) => entry.id === chatId);
    const groupId = ctx.h.groupIdForChat(chatId);
    const detail = groupId === undefined ? undefined : s.groupDetails.get(groupId);
    const meId = state.me?.id ?? state.currentUserId;
    const member = detail?.members.find((entry) => entry.userId === meId);
    return canPinFor(chat, chat?.myRole ?? member?.role);
  }

  const actions: PinActions = {
    pins: (chatId) => {
      void (pinsRevisionByChat.get(chatId) ?? 0);
      return pinsByChat.get(chatId) ?? EMPTY_PINS;
    },
    refreshPins: (chatId) => ctx.run(loadPins(chatId, true)),
    // Paint the cached pins of a cold start before the pins answer; a chat that already has pins keeps them.
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

  // Sign-out drops the per-chat pins, so the next user on the same install never sees the previous user's pins (a DM's chat id is the peer's JID). The bump also invalidates a load still in flight. This writes no state: the caller must follow with a `set()` for selectors to re-fire.
  function clear(): void {
    pinsEpoch += 1;
    pinsByChat.clear();
    pinsRevisionByChat.clear();
  }

  return { actions, loadPins, clear };
}
