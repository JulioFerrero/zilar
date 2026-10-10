import { StickerSchema, isValid } from '@zilar/protocol';
import { Effect } from 'effect';
import { useCallback, useState } from 'react';
import { Keyboard } from 'react-native';

import { step } from '@/components/chat/composer-media';
import type { EmojiSheetTab } from '@/components/chat/emoji-sheet';
import { probeGifsAvailability } from '@/components/chat/gif-panel';
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
import type { RecentStickerEntry, StickerChoice, StickerPack } from '@/lib/stickers';
import { RECENTS_STORAGE, readStoredRecents } from '@/lib/stickers-storage';
import type { SendStickerChoice } from '@/store/types';

/**
 * The composer's emoji/sticker/GIF sheet wiring (T-0175): the sheet open tab,
 * the sticker packs and recents, the GIF availability probe and the pick
 * handlers. The `Composer` renders the `EmojiSheet` from this state.
 */
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
  // The sticker panel: the user's packs from the server (the shared mock
  // backend in mock mode), a per-device Recent row, tap-to-send. Loading, error + retry, and
  // the "create on web" empty state live in `StickerGrid` (shown inside the
  // emoji sheet's Stickers tab).
  const [packs, setPacks] = useState<StickerPack[] | undefined>(undefined);
  const [panelState, setPanelState] = useState<StickerPanelState>('loading');
  const [recents, setRecents] = useState<RecentStickerEntry[]>([]);
  const [activePackId, setActivePackId] = useState<string | undefined>(undefined);

  // The latest load wins: a Retry while an older load runs replaces it.
  const [, loadPacks] = useAction<void, StickerPack[] | void, never>(
    () =>
      step(() => loadStickerPacks(stickersApi)).pipe(
        Effect.tap((loaded) =>
          Effect.sync(() => {
            setPacks(loaded);
            // A pack deleted on the web leaves a stale tab: reset it so the
            // panel resolves back to Recent or the first pack.
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

  // The GIF tab: hidden once the server answers 501 (provider off), probed
  // once per session. Mock mode probes the shared backend the same way.
  const [gifAvailable, setGifAvailable] = useState<boolean | undefined>(() => gifsAvailability());

  // The one emoji sheet (T-0175): tabs Emoji | Stickers | GIFs. Emoji first
  // and selected by default; the last tab is remembered for the session.
  // The GIFs tab hides when the provider is off (the probe above), and a
  // tab that disappears under the active tab falls back to the first
  // visible one (in `EmojiSheet`), so the sheet never vanishes.
  const [sheetOpen, setSheetOpen] = useState(false);
  const [sheetTab, setSheetTab] = useState<EmojiSheetTab | undefined>(undefined);
  const [emojiRecents, setEmojiRecents] = useState<string[]>([]);
  const [emojiCategory, setEmojiCategory] = useState<EmojiCategoryId | 'recent' | undefined>(
    undefined,
  );

  // Opening the sheet reads both recents and, once per session, probes the
  // GIF provider. A failed read leaves the row empty; the reads run side by
  // side and a reopen replaces a run that is still going.
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
            ? step(() => probeGifsAvailability(gifsApi)).pipe(
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
    // On Android with the keyboard open the sheet replaces the keyboard:
    // dismiss it now, and a tap on the field brings it back.
    Keyboard.dismiss();
    setSheetOpen(true);
    loadPanel();
    hydrateSheet(gifsAvailability() === undefined);
  };

  const closeSheet = () => setSheetOpen(false);

  // Remembering a picked emoji or sticker never blocks typing or sending: a
  // failing store leaves the row as it was.
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

  // Tapping an emoji inserts it at the caret and keeps the sheet open, so
  // several can be added; the sheet closes with its handle, a tap outside,
  // or the back button.
  const pickEmoji = (emoji: string) => {
    const { text: next, caret } = insertEmojiAtCaret(text, emoji, selection);
    setText(next);
    setSelection({ start: caret, end: caret });
    trackEmojiChange(text, next, caret);
    rememberEmoji({ recents: emojiRecents, emoji });
  };

  const pickSticker = (sticker: StickerChoice) => {
    setSheetOpen(false);
    // Validate before persisting: a hostile or drifted choice shows the
    // store's error and is never written to Recents.
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
