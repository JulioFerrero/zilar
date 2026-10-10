import { Effect } from 'effect';
import { type GroupBackground } from '@/lib/api';
import { type SaveFailed, type Scope, writeSave } from './backgroundOps';

export interface BackgroundWriteDeps {
  readonly chatId: string;
  readonly isGroup: boolean;
  readonly scope: Scope;
  readonly groupBackground: GroupBackground | undefined;
  readonly chatImageId: string | null;
  readonly defaultImageId: string | null;
  readonly setError: (value: boolean) => void;
  readonly setGroupBackground: (chatId: string, background: GroupBackground) => Promise<void>;
  readonly setChatBackground: (chatId: string, presetId: string | null) => Promise<void>;
  readonly setDefaultBackground: (presetId: string | null) => Promise<void>;
  readonly setChatBackgroundImage: (chatId: string, imageId: string, dim: number) => Promise<void>;
  readonly setDefaultBackgroundImage: (imageId: string, dim: number) => Promise<void>;
}

export interface BackgroundWrites {
  persist: (write: () => Promise<void>) => Effect.Effect<void>;
  writePreset: (presetId: string | null) => Promise<void>;
  writeImage: (imageId: string, nextDim: number, targetScope: Scope) => Promise<void>;
  clearDeletedSelection: (id: string) => Effect.Effect<void, SaveFailed>;
}

export function createBackgroundWrites({
  chatId,
  isGroup,
  scope,
  groupBackground,
  chatImageId,
  defaultImageId,
  setError,
  setGroupBackground,
  setChatBackground,
  setDefaultBackground,
  setChatBackgroundImage,
  setDefaultBackgroundImage,
}: BackgroundWriteDeps): BackgroundWrites {
  // A store write; a rejection shows the save sentence. Each save starts by
  // clearing the previous save error.
  const persist = (write: () => Promise<void>): Effect.Effect<void> =>
    Effect.sync(() => setError(false)).pipe(
      Effect.andThen(writeSave(write)),
      Effect.catchTag('SaveFailed', () => Effect.sync(() => setError(true))),
    );

  const writePreset = (presetId: string | null): Promise<void> => {
    if (isGroup) {
      return setGroupBackground(chatId, {
        backgroundPreset: presetId,
        backgroundImageId: null,
        backgroundDim: null,
      });
    }
    return scope === 'chat' ? setChatBackground(chatId, presetId) : setDefaultBackground(presetId);
  };

  // `targetScope` is passed in rather than read from the render closure so a
  // timer scheduled under one scope can never write under another.
  const writeImage = (imageId: string, nextDim: number, targetScope: Scope): Promise<void> => {
    if (isGroup) {
      return setGroupBackground(chatId, {
        backgroundPreset: null,
        backgroundImageId: imageId,
        backgroundDim: nextDim,
      });
    }
    return targetScope === 'chat'
      ? setChatBackgroundImage(chatId, imageId, nextDim)
      : setDefaultBackgroundImage(imageId, nextDim);
  };

  // The server clears a deleted image from any pref that referenced it; the
  // store is patched to match so the chat stops painting the now-404 URL.
  const clearDeletedSelection = (id: string): Effect.Effect<void, SaveFailed> => {
    if (isGroup) {
      return groupBackground?.backgroundImageId === id
        ? writeSave(() =>
            setGroupBackground(chatId, {
              backgroundPreset: null,
              backgroundImageId: null,
              backgroundDim: null,
            }),
          )
        : Effect.void;
    }
    const clearChat: Effect.Effect<void, SaveFailed> =
      chatImageId === id ? writeSave(() => setChatBackground(chatId, null)) : Effect.void;
    const clearDefault: Effect.Effect<void, SaveFailed> =
      defaultImageId === id ? writeSave(() => setDefaultBackground(null)) : Effect.void;
    return clearChat.pipe(Effect.andThen(clearDefault));
  };

  return { persist, writePreset, writeImage, clearDeletedSelection };
}
