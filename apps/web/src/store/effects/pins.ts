// Pins of a chat and the chat media panel. Loading pins is best effort: the
// chat works without them. Pinning and unpinning paint first and roll back
// when the server refuses.
import { Cause, Effect, Exit } from 'effect';
import type { MediaPage, MediaTab, Pin, PinMessageInput } from '@/lib/api';
import { isTrustedMediaUrl, trustedMediaHosts } from '@/lib/attachments';
import type { StoreCtx } from './ctx';
import { Ports } from './ports';
import { fromPromise } from './util';

/** Loads the pins of `chatId` into the store; a failure is ignored. */
export const refreshPinsFor = (ctx: StoreCtx, chatId: string): Effect.Effect<void, never, Ports> =>
  Effect.gen(function* () {
    const { api } = yield* Ports;
    const pins = yield* fromPromise(() => api.listPins(chatId));
    ctx.set((state) => ({
      pinsByChat: { ...state.pinsByChat, [chatId]: pins },
      pinsReady: { ...state.pinsReady, [chatId]: true },
    }));
  }).pipe(Effect.catchCause(() => Effect.void));

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
    const { k } = ctx;
    const message = k.listFor(ctx.get(), chatId).find((item) => k.sameMessage(item.id, messageId));
    if (message === undefined) {
      return yield* Effect.fail(new Error('Message not found'));
    }
    const kind: Pin['kind'] =
      message.voice !== undefined
        ? 'voice'
        : message.image !== undefined ||
            (message.attachment !== undefined && message.attachment.kind === 'image')
          ? 'image'
          : message.attachment !== undefined
            ? 'file'
            : message.card !== undefined
              ? 'card'
              : 'text';
    const snapshot: PinMessageInput = {
      chat: chatId,
      messageId: message.id,
      senderName: message.senderName.slice(0, 80) || 'Someone',
      ...(kind === 'text' ? { text: (message.text ?? '').slice(0, 300) } : { text: '' }),
      kind,
    };
    const before = ctx.get().pinsByChat[chatId] ?? [];
    const optimistic: Pin = {
      ...snapshot,
      id: `pin-local-${message.id}`,
      pinnedBy: ctx.get().currentUserId,
      pinnedAt: new Date().toISOString(),
    };
    ctx.set((state) => ({
      pinsByChat: {
        ...state.pinsByChat,
        [chatId]: [optimistic, ...(state.pinsByChat[chatId] ?? [])],
      },
      pinsError: undefined,
    }));
    const saved = yield* Effect.exit(fromPromise(() => api.pinMessage(snapshot)));
    if (Exit.isFailure(saved)) {
      ctx.set((state) => ({
        pinsByChat: { ...state.pinsByChat, [chatId]: before },
        pinsError: { chatId, message: 'Could not pin the message. Try again.' },
      }));
      return yield* Effect.fail(Cause.squash(saved.cause));
    }
    ctx.set((state) => ({
      pinsByChat: {
        ...state.pinsByChat,
        [chatId]: (state.pinsByChat[chatId] ?? []).map((pin) =>
          pin.id === optimistic.id ? saved.value : pin,
        ),
      },
    }));
  });

/** Unpins a message: the pin leaves at once and comes back if the server refuses. */
export const unpinMessage = (
  ctx: StoreCtx,
  chatId: string,
  pinId: string,
): Effect.Effect<void, unknown, Ports> =>
  Effect.gen(function* () {
    const { api } = yield* Ports;
    const before = ctx.get().pinsByChat[chatId] ?? [];
    ctx.set((state) => ({
      pinsByChat: {
        ...state.pinsByChat,
        [chatId]: (state.pinsByChat[chatId] ?? []).filter((pin) => pin.id !== pinId),
      },
      pinsError: undefined,
    }));
    const removed = yield* Effect.exit(fromPromise(() => api.unpinMessage(pinId)));
    if (Exit.isFailure(removed)) {
      ctx.set((state) => ({
        pinsByChat: { ...state.pinsByChat, [chatId]: before },
        pinsError: { chatId, message: 'Could not unpin the message. Try again.' },
      }));
      return yield* Effect.fail(Cause.squash(removed.cause));
    }
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
