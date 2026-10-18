// Per-chat preferences and the global chat background. chatPrefs is the saved truth and the
// chat summaries carry the optimistic paint; a failed write re-merges the saved rows, so
// anything that landed meanwhile survives.
import { Cause, Effect, Exit } from 'effect';
import { applyChatPrefs, mutedUntilFor, type MuteDurationId } from '@zilar/chat-core';
import {
  updatePref as updatePrefCore,
  optimisticPrefRow,
  type PrefsStore,
} from '@zilar/client-core/store';
import type { ChatBackgroundChoice, ChatPref, PutChatPrefInput } from '@/lib/api';
import { syncBadgeInBackground } from './badge';
import type { StoreCtx } from './ctx';
import { Ports } from './ports';
import { saveChatList } from './reads';
import { fromPromise, prefsByJid } from './util';

const patchedOrSaved = <T>(patch: T | undefined, saved: T | null | undefined): T | null =>
  patch !== undefined ? patch : (saved ?? null);

// The optimistic row for a partial write, with the web-only background columns merged over
// the saved row too, so they never flash off during the PUT flight.
function optimisticRow(
  chatId: string,
  saved: readonly ChatPref[],
  patch: PutChatPrefInput,
  nowDate: Date,
): ChatPref {
  return optimisticPrefRow(chatId, saved, patch, nowDate, (row, previous) => ({
    ...row,
    backgroundPreset: patchedOrSaved(patch.backgroundPreset, previous?.backgroundPreset),
    backgroundImageId: patchedOrSaved(patch.backgroundImageId, previous?.backgroundImageId),
    backgroundDim: patchedOrSaved(patch.backgroundDim, previous?.backgroundDim),
  }));
}

function prefsStore(ctx: StoreCtx): PrefsStore<PutChatPrefInput, ChatPref> {
  return {
    savedRows: () => Object.values(ctx.get().chatPrefs),
    setSavedRows: (rows) => ctx.set({ chatPrefs: prefsByJid([...rows]) }),
    // Only the chat summaries are painted optimistically; chatPrefs stays the saved truth.
    paint: (rows) => {
      ctx.set((state) => ({
        chats: applyChatPrefs(state.chats, [...rows], ctx.ports.now().getTime()),
      }));
      syncBadgeInBackground(ctx);
    },
    optimisticRow,
  };
}

/** A thin alias for the shared applyChatPrefs, which maps the hand-set unread mark; callers
 * still import this name. */
export const applyPrefsWithUnreadMark = applyChatPrefs;

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
    if (Exit.isFailure(loaded) || ctx.rt.session() !== session) {
      return;
    }
    ctx.set({ defaultBackground: loaded.value });
  });

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

// Marks a chat unread by hand (the row keeps an unread dot), or clears the mark; optimistic
// with rollback, like the other prefs.
export const setUnreadMark = (
  ctx: StoreCtx,
  chatId: string,
  unreadMark: boolean,
): Effect.Effect<void, unknown, Ports> => updatePref(ctx, chatId, { unreadMark });

// Picks a preset for one chat; null clears the override so the chat inherits the global default.
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

// Picks an uploaded image for one chat, with the dim percentage.
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

// Picks the global default, optimistic with rollback; the saved default replaces it.
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
