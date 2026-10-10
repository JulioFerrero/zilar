// Pins of a chat and the chat media panel. Loading pins is best effort: the
// chat works without them. Pinning and unpinning paint first and roll back
// when the server refuses; the shared logic (and the two error texts) lives in
// `@zilar/client-core/store`, this file binds it to the web state.
import { Effect } from 'effect';
import {
  loadPins as loadPinsCore,
  pinMessage as pinMessageCore,
  unpinMessage as unpinMessageCore,
  type PinsStore,
} from '@zilar/client-core/store';
import type { MediaPage, MediaTab } from '@/lib/api';
import { isTrustedMediaUrl, trustedMediaHosts } from '@/lib/attachments';
import type { StoreCtx } from './ctx';
import { Ports } from './ports';
import { fromPromise } from './util';

/** Binds the core pins logic to the web state (`pinsByChat`, `pinsReady`, `pinsError`). */
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

/** Loads the pins of `chatId` into the store; a failure is ignored. */
export const refreshPinsFor = (ctx: StoreCtx, chatId: string): Effect.Effect<void, never, Ports> =>
  Effect.gen(function* () {
    const { api } = yield* Ports;
    yield* loadPinsCore(ctx, api, pinsStore(ctx), chatId, false);
  });

// An image or GIF item on an untrusted host is downgraded to a file-style item
// by dropping its `url`, so the panel never auto-loads it (T-0434). With no
// XMPP token yet, nothing is trusted and every such url is dropped.
const sanitizeMediaPage = (ctx: StoreCtx, page: MediaPage): MediaPage => {
  const trusted = ctx.mediaToken === undefined ? undefined : trustedMediaHosts(ctx.mediaToken);
  return {
    ...page,
    items: page.items.map((item) => {
      if (item.kind !== 'image' && item.kind !== 'gif') {
        return item;
      }
      if (
        item.url === undefined ||
        trusted === undefined ||
        !isTrustedMediaUrl(item.url, trusted)
      ) {
        const { url: _dropped, ...rest } = item;
        void _dropped;
        return rest;
      }
      return item;
    }),
  };
};

/** One page of the chat media panel, with untrusted urls dropped. */
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
    return sanitizeMediaPage(ctx, page);
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

// XEP-0357 enable/disable over the user's own session (ejabberd requires it;
// there is no admin shortcut). Fails offline or when the core cannot send raw
// IQs, so the settings page can roll back.
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
