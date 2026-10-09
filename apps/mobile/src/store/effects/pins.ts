import { Effect } from 'effect';

import { API_URL } from '../../lib/auth';
import { isTrustedMediaUrl } from '../../lib/attachments';
import type { MediaItem } from '../../lib/media-api';
import { pinKindFor, pinSnapshotText, type Pin } from '../../lib/pins-api';
import type { ChatStoreState } from '../types';
import { Ports } from './ports';
import { failAfter, lift, recover, type StoreCtx } from './runtime';

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
}

/** Pins (T-0135) and the media panel (T-0436). */
export function makePins(ctx: StoreCtx): Pins {
  const { ports, get, set, s, h } = ctx;
  const { pins: pinsApi, media: mediaApi, now } = ports;

  // Pins by chat id (T-0135), newest first. Loaded when a chat opens and
  // refreshed on focus and every 60 s while it is open. Each publish bumps
  // the chat's revision once, so `pins(chatId)` selectors re-fire exactly
  // once per publish.
  const pinsByChat = new Map<string, Pin[]>();
  const pinsRevisionByChat = new Map<string, number>();
  let pinsRevision = 0;

  // Publishes one chat's pins and bumps its revision, so selectors for
  // that chat re-fire exactly once per publish.
  function publishPins(chatId: string, pins: Pin[]): void {
    pinsByChat.set(chatId, pins);
    pinsRevision += 1;
    pinsRevisionByChat.set(chatId, pinsRevision);
    set((state) => ({
      pinsError: state.pinsError?.chatId === chatId ? undefined : state.pinsError,
    }));
  }

  // Publishes an optimistic pins change (pin/unpin/rollback) for one
  // chat: same single bump, so the revision always matches the map.
  function publishOptimisticPins(chatId: string, pins: Pin[]): void {
    pinsByChat.set(chatId, pins);
    pinsRevision += 1;
    pinsRevisionByChat.set(chatId, pinsRevision);
    set((state) => ({ pinsError: state.pinsError }));
  }

  // A failure surfaces as `pinsError` for an explicit load, stays silent on
  // the background tick (the next tick retries).
  const loadPins = (chatId: string, loud: boolean): Effect.Effect<void, never, Ports> =>
    recover(
      lift(() => pinsApi.listPins(chatId)).pipe(
        Effect.flatMap((pins) => Effect.sync(() => publishPins(chatId, pins))),
      ),
      () =>
        Effect.sync(() => {
          if (loud) {
            set({ pinsError: { chatId, message: 'Could not load pins. Try again.' } });
          }
        }),
    ).pipe(Effect.asVoid);

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

  // The gallery never auto-loads an image or gif from a host outside the
  // trusted set: the row keeps its metadata but loses `url`, so the sheet
  // renders it as a file row (T-0436, mirroring the attachments rule).
  function sanitizeMediaItem(item: MediaItem): MediaItem {
    if (item.url === undefined) {
      return item;
    }
    const resolved = resolveMediaUrl(item.url, API_URL);
    if (
      (item.kind === 'image' || item.kind === 'gif') &&
      !isTrustedMediaUrl(resolved, s.mediaTrustedHosts)
    ) {
      const copy: MediaItem = { ...item };
      delete copy.url;
      return copy;
    }
    return { ...item, url: resolved };
  }

  const actions: PinActions = {
    pins: (chatId) => {
      // Reading the revision subscribes the selector to pin publishes
      // for this chat, like `groupDetail` does with its own revision.
      void (pinsRevisionByChat.get(chatId) ?? 0);
      return pinsByChat.get(chatId) ?? EMPTY_PINS;
    },
    refreshPins: (chatId) => ctx.run(loadPins(chatId, true)),
    pinFor: (chatId, messageId) =>
      pinsByChat.get(chatId)?.find((pin) => pin.messageId === messageId),
    canPin: (chatId) => canPinIn(chatId),
    pinMessage: (chatId, messageId) =>
      ctx.run(
        Effect.gen(function* () {
          if (!canPinIn(chatId)) {
            return yield* Effect.fail(new Error('You cannot pin here.'));
          }
          const message = h
            .listFor(get(), chatId)
            .find((item) => h.sameMessage(item.id, messageId));
          if (message === undefined) {
            return yield* Effect.fail(new Error('Message not found'));
          }
          const shape = {
            text: message.text,
            image: message.image,
            voice: message.voice,
            card: message.card,
            attachment: message.attachment,
          };
          const snapshot = {
            chat: chatId,
            messageId: message.id,
            senderName: message.senderName,
            text: pinSnapshotText({ ...shape, deleted: message.deleted }),
            kind: pinKindFor(shape),
          };
          const before = pinsByChat.get(chatId) ?? [];
          const optimistic: Pin = {
            ...snapshot,
            id: `pin-local-${now().getTime()}`,
            pinnedBy: get().me?.id ?? get().currentUserId,
            pinnedAt: new Date(now().getTime()).toISOString(),
          };
          publishOptimisticPins(chatId, [optimistic, ...before]);
          yield* failAfter(
            lift(() => pinsApi.pinMessage(snapshot)).pipe(
              Effect.flatMap((saved) =>
                Effect.sync(() => {
                  const current = pinsByChat.get(chatId) ?? [];
                  publishOptimisticPins(
                    chatId,
                    current.some((pin) => pin.id === saved.id)
                      ? current.map((pin) => (pin.id === optimistic.id ? saved : pin))
                      : [saved, ...current.filter((pin) => pin.id !== optimistic.id)],
                  );
                }),
              ),
            ),
            () => Effect.sync(() => publishOptimisticPins(chatId, before)),
          );
        }),
      ),
    unpinMessage: (chatId, pinId) =>
      ctx.run(
        Effect.gen(function* () {
          const before = pinsByChat.get(chatId) ?? [];
          publishOptimisticPins(
            chatId,
            before.filter((pin) => pin.id !== pinId),
          );
          yield* failAfter(
            lift(() => pinsApi.unpinMessage(pinId)).pipe(
              Effect.flatMap((echoed) =>
                Effect.sync(() => {
                  const current = pinsByChat.get(chatId) ?? [];
                  publishOptimisticPins(
                    chatId,
                    current.filter((pin) => pin.id !== echoed.id),
                  );
                }),
              ),
            ),
            () =>
              Effect.sync(() => {
                publishOptimisticPins(chatId, before);
                set({ pinsError: { chatId, message: 'Could not unpin. Try again.' } });
              }),
          );
        }),
      ),
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
            items: page.items.map((item) => sanitizeMediaItem(item)),
            next: page.next,
          };
        }),
      ),
  };

  return { actions, loadPins };
}
