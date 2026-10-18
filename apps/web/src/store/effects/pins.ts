// Pins load best effort: the chat works without them. Pinning paints first and rolls back
// when the server refuses; the shared logic lives in @zilar/client-core/store.
import { Effect } from 'effect';
import {
  loadPins as loadPinsCore,
  pinMessage as pinMessageCore,
  sanitizeMediaItems,
  unpinMessage as unpinMessageCore,
  type PinsStore,
} from '@zilar/client-core/store';
import type { MediaPage, MediaTab } from '@/lib/api';
import { isTrustedMediaUrl, trustedMediaHosts } from '@/lib/attachments';
import type { StoreCtx } from './ctx';
import { Ports } from './ports';
import { fromPromise } from './util';

function pinsStore(ctx: StoreCtx): PinsStore {
  return {
    pins: (chatId) => ctx.get().pinsByChat[chatId] ?? [],
    publish: (chatId, pins) =>
      ctx.set((state) => ({ pinsByChat: { ...state.pinsByChat, [chatId]: [...pins] } })),
    markReady: (chatId) =>
      ctx.set((state) => ({ pinsReady: { ...state.pinsReady, [chatId]: true } })),
    setError: (error) => ctx.set({ pinsError: error }),
    currentUserId: () => ctx.get().currentUserId,
  };
}

/** Loads the pins of chatId into the store; a failure is ignored. */
export const refreshPinsFor = (ctx: StoreCtx, chatId: string): Effect.Effect<void, never, Ports> =>
  Effect.gen(function* () {
    const { api } = yield* Ports;
    yield* loadPinsCore(ctx, api, pinsStore(ctx), chatId, false);
  });

// An image or GIF item on an untrusted host is downgraded to a file-style item by dropping
// its url, so the panel never auto-loads it; with no XMPP token yet, nothing is trusted.
const trustedMediaFilter = (ctx: StoreCtx): ((url: string) => boolean) | undefined => {
  const token = ctx.mediaToken;
  if (token === undefined) {
    return undefined;
  }
  const hosts = trustedMediaHosts(token);
  return (url) => isTrustedMediaUrl(url, hosts);
};

export const loadChatMedia = (
  ctx: StoreCtx,
  chatId: string,
  tab: MediaTab,
  before: string | undefined,
): Effect.Effect<MediaPage, unknown, Ports> =>
  Effect.gen(function* () {
    const { api } = yield* Ports;
    const page = yield* fromPromise(() =>
      api.listChatMedia({
        chat: chatId,
        type: tab,
        ...(before === undefined ? {} : { before }),
      }),
    );
    return { ...page, items: sanitizeMediaItems(page.items, trustedMediaFilter(ctx)) };
  });

/** Pins a message: the pin shows at once and is replaced by the saved one. */
export const pinMessage = (
  ctx: StoreCtx,
  chatId: string,
  messageId: string,
): Effect.Effect<void, unknown, Ports> =>
  Effect.gen(function* () {
    const { api } = yield* Ports;
    yield* pinMessageCore(ctx, api, pinsStore(ctx), chatId, messageId);
  });

/** Unpins a message: the pin leaves at once and comes back if the server refuses. */
export const unpinMessage = (
  ctx: StoreCtx,
  chatId: string,
  pinId: string,
): Effect.Effect<void, unknown, Ports> =>
  Effect.gen(function* () {
    const { api } = yield* Ports;
    yield* unpinMessageCore(ctx, api, pinsStore(ctx), chatId, pinId);
  });

// XEP-0357 enable/disable over the user's own session (ejabberd requires it; there is no
// admin shortcut). Fails offline or when the core cannot send raw IQs, so the page rolls back.
export const setPushPair = (
  ctx: StoreCtx,
  input: { pushJid: string; node: string; enable: boolean },
): Effect.Effect<void, unknown> =>
  Effect.suspend(() => {
    const current = ctx.core;
    if (current === undefined || current.setPushEnabled === undefined) {
      return Effect.fail(new Error('the chat connection cannot toggle push'));
    }
    const enable = current.setPushEnabled.bind(current);
    return fromPromise(() => enable(input));
  });
