// Per-chat preferences (pin, mute, archive, background) and the default chat
// background. Each setter paints the change at once and rolls it back when the
// server refuses, then rethrows so the caller can show its own error.
import { Cause, Effect, Exit } from 'effect';
import type { ChatBackgroundChoice, ChatPref, PutChatPrefInput } from '@/lib/api';
import { applyChatPrefs, mutedUntilFor, type MuteDurationId } from '@/lib/chatPrefs';
import { syncBadgeInBackground } from './badge';
import type { StoreCtx } from './ctx';
import { Ports } from './ports';
import { saveChatList } from './reads';
import { fromPromise, prefsByJid } from './util';

// T-0113: replaces the pref map and merges it into the painted list.
export function applyPrefs(ctx: StoreCtx, prefs: ChatPref[]): void {
  ctx.set((state) => ({
    chatPrefs: prefsByJid(prefs),
    chats: applyChatPrefs(state.chats, prefs, ctx.ports.now().getTime()),
  }));
  syncBadgeInBackground(ctx);
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

// T-0113: patches one row optimistically and rolls back to the previous pref
// state when the PUT fails.
const updatePref = (
  ctx: StoreCtx,
  chatId: string,
  patch: PutChatPrefInput,
): Effect.Effect<void, unknown, Ports> =>
  Effect.gen(function* () {
    const { api, now } = yield* Ports;
    const chat = ctx.get().chats.find((entry) => entry.id === chatId);
    if (chat === undefined) {
      return yield* Effect.fail(new Error('This chat is not available yet.'));
    }
    const previous = ctx.get().chatPrefs;
    const nowDate = now();
    const key = chatId.toLowerCase();
    const optimistic: ChatPref = {
      chatJid: chatId,
      mutedUntil:
        patch.mutedUntil !== undefined ? patch.mutedUntil : (previous[key]?.mutedUntil ?? null),
      archived: patch.archived !== undefined ? patch.archived : (previous[key]?.archived ?? false),
      pinnedAt:
        patch.pinned !== undefined
          ? patch.pinned
            ? (previous[key]?.pinnedAt ?? nowDate.toISOString())
            : null
          : (previous[key]?.pinnedAt ?? null),
      // T-0462: keep the background override on the optimistic row. A patch
      // value wins, an omitted field keeps the previous one, else null.
      backgroundPreset:
        patch.backgroundPreset !== undefined
          ? patch.backgroundPreset
          : (previous[key]?.backgroundPreset ?? null),
      backgroundImageId:
        patch.backgroundImageId !== undefined
          ? patch.backgroundImageId
          : (previous[key]?.backgroundImageId ?? null),
      backgroundDim:
        patch.backgroundDim !== undefined
          ? patch.backgroundDim
          : (previous[key]?.backgroundDim ?? null),
      updatedAt: nowDate.toISOString(),
    };
    const next: Record<string, ChatPref> = { ...previous };
    if (
      optimistic.mutedUntil === null &&
      optimistic.archived === false &&
      optimistic.pinnedAt === null &&
      optimistic.backgroundPreset === null &&
      optimistic.backgroundImageId === null &&
      optimistic.backgroundDim === null
    ) {
      delete next[key];
    } else {
      next[key] = optimistic;
    }
    ctx.set((state) => ({
      chatPrefs: next,
      chats: applyChatPrefs(state.chats, Object.values(next), nowDate.getTime()),
    }));
    // Muting changes the badge total (and unmuting restores it): re-sync like
    // recordRead does, on the optimistic paint and on every settle.
    syncBadgeInBackground(ctx);
    const saved = yield* Effect.exit(fromPromise(() => api.putChatPref(chatId, patch)));
    if (Exit.isFailure(saved)) {
      // Roll back to the previous prefs and re-merge.
      ctx.set((state) => ({
        chatPrefs: previous,
        chats: applyChatPrefs(state.chats, Object.values(previous), now().getTime()),
      }));
      syncBadgeInBackground(ctx);
      return yield* Effect.fail(Cause.squash(saved.cause));
    }
    ctx.set((state) => {
      const merged: Record<string, ChatPref> = { ...ctx.get().chatPrefs };
      if (saved.value === null) {
        delete merged[key];
      } else {
        merged[key] = saved.value;
      }
      return {
        chatPrefs: merged,
        chats: applyChatPrefs(state.chats, Object.values(merged), now().getTime()),
      };
    });
    syncBadgeInBackground(ctx);
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
// `updatePref` patches the row optimistically and rolls back on failure.
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
