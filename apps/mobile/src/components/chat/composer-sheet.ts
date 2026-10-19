import { StickerSchema, isValid } from '@zilar/protocol';
import { probeGifsAvailability } from '@zilar/client-core';
import { Effect } from 'effect';
import { useCallback, useEffect, useState } from 'react';
import { BackHandler, Keyboard } from 'react-native';

import { step } from '@/components/chat/composer-media';
import { defaultGifsApi } from '@/components/chat/gif-panel';
import { loadStickerPacks, persistRecent } from '@/components/chat/sticker-panel';
import type { StickerPanelState } from '@/components/chat/sticker-panel';
import { useAction } from '@/lib/effect/use-action';
import {
  EMOJI_RECENTS_STORAGE,
  insertEmojiAtCaret,
  persistEmojiRecent,
  readStoredEmojiRecents,
  type CaretSelection,
  type EmojiCategoryId,
} from '@/lib/emoji-data';
import { gifsAvailability } from '@/lib/gifs';
import type { GifsApi } from '@/lib/gifs-api';
import type { StickersApi } from '@/lib/stickers-api';
import type { RecentStickerEntry, StickerPack } from '@/lib/stickers';
import type { StickerChoice } from '@zilar/chat-core';
import { RECENTS_STORAGE, readStoredRecents } from '@/lib/stickers-storage';
import type { SendStickerChoice } from '@/store/types';

export type EmojiSheetTab = 'emoji' | 'stickers' | 'gifs';

export function useComposerSheet({
  text,
  setText,
  selection,
  setSelection,
  stickersApi,
  gifsApi,
  onSendSticker,
  trackEmojiChange,
}: {
  text: string;
  setText: (text: string) => void;
  selection: CaretSelection | undefined;
  setSelection: (selection: CaretSelection) => void;
  stickersApi: StickersApi | undefined;
  gifsApi: GifsApi | undefined;
  onSendSticker: (sticker: SendStickerChoice) => void;
  trackEmojiChange: (previousText: string, nextText: string, caret: number) => void;
}) {
  const [packs, setPacks] = useState<StickerPack[] | undefined>(undefined);
  const [panelState, setPanelState] = useState<StickerPanelState>('loading');
  const [recents, setRecents] = useState<RecentStickerEntry[]>([]);
  const [activePackId, setActivePackId] = useState<string | undefined>(undefined);

  // The latest load wins: a Retry replaces an older load.
  const [, loadPacks] = useAction<void, StickerPack[] | void, never>(
    () =>
      step(() => loadStickerPacks(stickersApi)).pipe(
        Effect.tap((loaded) =>
          Effect.sync(() => {
            setPacks(loaded);
            setActivePackId((current) =>
              current !== undefined && loaded.some((pack) => pack.id === current)
                ? current
                : undefined,
            );
            setPanelState(loaded.length === 0 ? 'empty' : 'ready');
          }),
        ),
        Effect.catchTag('ComposerStepFailed', () => Effect.sync(() => setPanelState('error'))),
      ),
    { mode: 'replace' },
  );

  const loadPanel = useCallback(() => {
    setPanelState('loading');
    loadPacks();
  }, [loadPacks]);

  // The GIF tab hides once the server answers 501; probed once per session.
  const [gifAvailable, setGifAvailable] = useState<boolean | undefined>(() => gifsAvailability());

  // A tab that disappears under the active tab falls back to the first visible
  // one, so the sheet never shows an empty body.
  const [sheetOpen, setSheetOpen] = useState(false);
  const [sheetTab, setSheetTab] = useState<EmojiSheetTab | undefined>(undefined);
  const [emojiRecents, setEmojiRecents] = useState<string[]>([]);
  const [emojiCategory, setEmojiCategory] = useState<EmojiCategoryId | 'recent' | undefined>(
    undefined,
  );

  const [, hydrateSheet] = useAction(
    (probeGifs: boolean) =>
      Effect.all(
        [
          step(() => readStoredRecents()).pipe(
            Effect.tap((stored) => Effect.sync(() => setRecents(stored))),
            Effect.ignore,
          ),
          step(() => readStoredEmojiRecents()).pipe(
            Effect.tap((stored) => Effect.sync(() => setEmojiRecents(stored))),
            Effect.ignore,
          ),
          probeGifs
            ? probeGifsAvailability((gifsApi ?? defaultGifsApi()).trendingGifs).pipe(
                Effect.tap((available) => Effect.sync(() => setGifAvailable(available))),
                Effect.ignore,
              )
            : Effect.void,
        ],
        { concurrency: 'unbounded', discard: true },
      ),
    { mode: 'replace' },
  );

  const openSheet = () => {
    Keyboard.dismiss();
    setSheetOpen(true);
    loadPanel();
    hydrateSheet(gifsAvailability() === undefined);
  };

  const closeSheet = () => setSheetOpen(false);

  // Android Back closes the panel before it leaves the chat.
  useEffect(() => {
    if (!sheetOpen) {
      return;
    }
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      setSheetOpen(false);
      return true;
    });
    return () => subscription.remove();
  }, [sheetOpen]);

  const [, rememberEmoji] = useAction(
    (input: { recents: readonly string[]; emoji: string }) =>
      step(() => persistEmojiRecent(EMOJI_RECENTS_STORAGE, input.recents, input.emoji)).pipe(
        Effect.tap((next) => Effect.sync(() => setEmojiRecents(next))),
        Effect.ignore,
      ),
    { mode: 'replace' },
  );
  const [, rememberSticker] = useAction(
    (input: { recents: readonly RecentStickerEntry[]; sticker: StickerChoice }) =>
      step(() => persistRecent(RECENTS_STORAGE, input.recents, input.sticker)).pipe(
        Effect.tap((next) => Effect.sync(() => setRecents(next))),
        Effect.ignore,
      ),
    { mode: 'replace' },
  );

  const pickEmoji = (emoji: string) => {
    const { text: next, caret } = insertEmojiAtCaret(text, emoji, selection);
    setText(next);
    setSelection({ start: caret, end: caret });
    trackEmojiChange(text, next, caret);
    rememberEmoji({ recents: emojiRecents, emoji });
  };

  const pickSticker = (sticker: StickerChoice) => {
    setSheetOpen(false);
    // Validate before persisting: a hostile or drifted choice never reaches Recents.
    const data = {
      pack_id: sticker.packId,
      sticker_id: sticker.stickerId,
      url: sticker.url,
      ...(sticker.emoji === undefined ? {} : { emoji: sticker.emoji }),
      width: sticker.width,
      height: sticker.height,
      mime: sticker.mime,
    };
    if (!isValid(StickerSchema)(data)) {
      onSendSticker(sticker);
      return;
    }
    rememberSticker({ recents, sticker });
    onSendSticker(sticker);
  };

  return {
    sheetOpen,
    sheetTab,
    setSheetTab,
    emojiRecents,
    emojiCategory,
    setEmojiCategory,
    packs,
    panelState,
    recents,
    activePackId,
    setActivePackId,
    gifAvailable,
    loadPanel,
    openSheet,
    closeSheet,
    pickEmoji,
    pickSticker,
  };
}
