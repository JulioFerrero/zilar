// Per-chat preferences (pin, mute, archive, background) and the default chat
// background. The write itself lives in the core (`@zilar/client-core/store`);
// this file binds it to the web state: `chatPrefs` is the saved truth, and the
// chat summaries carry the optimistic paint. On a failed write the core
// re-merges the saved rows, so anything that landed meanwhile survives (R11).
import { Cause, Effect, Exit } from 'effect';
import { applyChatPrefs } from '@zilar/chat-core';
import { updatePref as updatePrefCore, type PrefsStore } from '@zilar/client-core/store';
import type { ChatBackgroundChoice, ChatPref, PutChatPrefInput } from '@/lib/api';
import { mutedUntilFor, type MuteDurationId } from '@/lib/chatPrefs';
import { syncBadgeInBackground } from './badge';
import type { StoreCtx } from './ctx';
import { Ports } from './ports';
import { saveChatList } from './reads';
import { fromPromise, prefsByJid } from './util';

const keyOf = (chatId: string): string => chatId.toLowerCase();

// The optimistic row for a partial write: the patch merged over the chat's
// saved row, so kept fields never flash off during the PUT flight.
function optimisticRow(
  chatId: string,
  saved: readonly ChatPref[],
  patch: PutChatPrefInput,
  nowDate: Date,
): ChatPref {
  const previous = saved.find((row) => keyOf(row.chatJid) === keyOf(chatId));
  return {
    chatJid: chatId,
    mutedUntil: patch.mutedUntil !== undefined ? patch.mutedUntil : (previous?.mutedUntil ?? null),
    archived: patch.archived !== undefined ? patch.archived : (previous?.archived ?? false),
    pinnedAt:
      patch.pinned !== undefined
        ? patch.pinned
          ? (previous?.pinnedAt ?? nowDate.toISOString())
          : null
        : (previous?.pinnedAt ?? null),
    backgroundPreset:
      patch.backgroundPreset !== undefined
        ? patch.backgroundPreset
        : (previous?.backgroundPreset ?? null),
    backgroundImageId:
      patch.backgroundImageId !== undefined
        ? patch.backgroundImageId
        : (previous?.backgroundImageId ?? null),
    backgroundDim:
      patch.backgroundDim !== undefined ? patch.backgroundDim : (previous?.backgroundDim ?? null),
    updatedAt: nowDate.toISOString(),
  };
}

/** Binds the core pref write to the web state: `chatPrefs` holds the saved rows. */
function prefsStore(ctx: StoreCtx): PrefsStore<PutChatPrefInput, ChatPref> {
  return {
    savedRows: () => Object.values(ctx.get().chatPrefs),
    setSavedRows: (rows) => ctx.set({ chatPrefs: prefsByJid([...rows]) }),
    // Only the chat summaries are painted optimistically; `chatPrefs` stays the
    // saved truth (updated above on settle, and by every background refresh).
    paint: (rows) => {
      ctx.set((state) => ({
        chats: applyChatPrefs(state.chats, [...rows], ctx.ports.now().getTime()),
      }));
      syncBadgeInBackground(ctx);
    },
    optimisticRow,
  };
}

// T-0113: replaces the pref map and merges it into the painted list.
export function applyPrefs(ctx: StoreCtx, prefs: ChatPref[]): void {
  const store = prefsStore(ctx);
  store.setSavedRows(prefs);
  store.paint(prefs);
}

/** Reloads the prefs; a failed load, or a session that ended meanwhile, changes nothing. */
export const refreshChatPrefs = (ctx: StoreCtx): Effect.Effect<void, never, Ports> =>
  Effect.gen(function* () {
    const { api } = yield* Ports;
    const session = ctx.rt.session();
    const loaded = yield* Effect.exit(fromPromise(() => api.listChatPrefs()));
    if (Exit.isFailure(loaded) || ctx.rt.session() !== session) {
      return;
    }
    applyPrefs(ctx, loaded.value);
  });

/** Reloads the default background; a failed load keeps the slate grid. */
export const refreshDefaultBackground = (ctx: StoreCtx): Effect.Effect<void, never, Ports> =>
  Effect.gen(function* () {
    const { api } = yield* Ports;
    const session = ctx.rt.session();
    const loaded = yield* Effect.exit(fromPromise(() => api.getChatBackgroundDefault()));
    // A failed load never blocks the chat list.
    if (Exit.isFailure(loaded) || ctx.rt.session() !== session) {
      return;
    }
    ctx.set({ defaultBackground: loaded.value });
  });

// T-0113: patches one chat's pref optimistically; see `@zilar/client-core/store`.
const updatePref = (
  ctx: StoreCtx,
  chatId: string,
  patch: PutChatPrefInput,
): Effect.Effect<void, unknown, Ports> =>
  Effect.gen(function* () {
    const { api } = yield* Ports;
    yield* updatePrefCore(ctx, api, prefsStore(ctx), chatId, patch);
  });

export const setPinned = (
  ctx: StoreCtx,
  chatId: string,
  pinned: boolean,
): Effect.Effect<void, unknown, Ports> => updatePref(ctx, chatId, { pinned });

export const setMuted = (
  ctx: StoreCtx,
  chatId: string,
  duration: MuteDurationId | null,
): Effect.Effect<void, unknown, Ports> =>
  updatePref(
    ctx,
    chatId,
    duration === null
      ? { mutedUntil: null }
      : { mutedUntil: mutedUntilFor(duration, ctx.ports.now()) },
  );

export const setArchived = (
  ctx: StoreCtx,
  chatId: string,
  archived: boolean,
): Effect.Effect<void, unknown, Ports> =>
  updatePref(ctx, chatId, { archived }).pipe(Effect.andThen(Effect.sync(() => saveChatList(ctx))));

// T-0462: pick a preset for one chat (null clears the override, so the chat
// inherits the caller's global default again).
export const setChatBackground = (
  ctx: StoreCtx,
  chatId: string,
  presetId: string | null,
): Effect.Effect<void, unknown, Ports> =>
  updatePref(ctx, chatId, {
    backgroundPreset: presetId,
    backgroundImageId: null,
    backgroundDim: null,
  });

// T-0464: pick an uploaded image for one chat, with the dim percentage.
export const setChatBackgroundImage = (
  ctx: StoreCtx,
  chatId: string,
  imageId: string,
  dim: number,
): Effect.Effect<void, unknown, Ports> =>
  updatePref(ctx, chatId, {
    backgroundPreset: null,
    backgroundImageId: imageId,
    backgroundDim: dim,
  });

// T-0462 / T-0464: pick the global default. Optimistic with rollback; the
// picker paints at once and the saved default replaces the optimistic value.
const putDefaultBackground = (
  ctx: StoreCtx,
  optimistic: ChatBackgroundChoice,
): Effect.Effect<void, unknown, Ports> =>
  Effect.gen(function* () {
    const { api } = yield* Ports;
    const previous = ctx.get().defaultBackground;
    ctx.set({ defaultBackground: optimistic });
    const saved = yield* Effect.exit(fromPromise(() => api.putChatBackgroundDefault(optimistic)));
    if (Exit.isFailure(saved)) {
      ctx.set({ defaultBackground: previous });
      return yield* Effect.fail(Cause.squash(saved.cause));
    }
    ctx.set({ defaultBackground: saved.value });
  });

export const setDefaultBackground = (
  ctx: StoreCtx,
  presetId: string | null,
): Effect.Effect<void, unknown, Ports> =>
  putDefaultBackground(ctx, {
    backgroundPreset: presetId,
    backgroundImageId: null,
    backgroundDim: null,
  });

export const setDefaultBackgroundImage = (
  ctx: StoreCtx,
  imageId: string,
  dim: number,
): Effect.Effect<void, unknown, Ports> =>
  putDefaultBackground(ctx, {
    backgroundPreset: null,
    backgroundImageId: imageId,
    backgroundDim: dim,
  });
