import { StickerSchema, isValid, type Attachment } from '@zilar/protocol';
import { Data, Effect, Fiber } from 'effect';
import { ArrowUp, Paperclip, Smile, X } from 'lucide-react-native';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Keyboard, Pressable, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AttachSheet, type AttachmentChoice } from '@/components/chat/attach-sheet';
import { EditBar } from '@/components/chat/edit-bar';
import { EmojiSheet, type EmojiSheetTab } from '@/components/chat/emoji-sheet';
import { loadStickerPacks, persistRecent } from '@/components/chat/sticker-panel';
import { VoiceRecorderButton } from '@/components/chat/voice-recorder';
import { IconButton } from '@/components/ui/icon-button';
import { Text } from '@/components/ui/text';
import { useKeyPress } from '@/components/ui/use-key-press';
import { createAttachmentPicker, createGifDownloader } from '@/lib/attachment-native';
import type { AttachmentPicker, GifDownloader, PickedFile } from '@/lib/attachment-ports';
import { ICON } from '@/lib/colors';
import { isWaiting, useAction } from '@/lib/effect/use-action';
import {
  ACCENT_FOREGROUND,
  KEY_PRIMARY_PRESSED_SHADOW,
  pressStyle,
  primaryKey,
  well,
} from '@/lib/depth';
import {
  EMOJI_RECENTS_STORAGE,
  insertEmojiAtCaret,
  persistEmojiRecent,
  readStoredEmojiRecents,
  type CaretSelection,
  type EmojiCategoryId,
} from '@/lib/emoji-data';
import {
  backspaceMention,
  caretAfterChange,
  isSingleCharBackspace,
  mentionCandidates,
  mentionStateForChange,
  pickMentionMember,
  resetMentionStateForChatKey,
} from '@/components/chat/composer-mentions';
import { MentionPicker } from '@/components/chat/mention-picker';
import { RECENTS_STORAGE, readStoredRecents } from '@/lib/stickers-storage';
import { gifsAvailability, type GifItem } from '@/lib/gifs';
import { probeGifsAvailability } from '@/components/chat/gif-panel';
import { mockDemoGifs } from '@/mock/gifs';
import type { RecentStickerEntry, StickerChoice, StickerPack } from '@/lib/stickers';
import type { StickerPanelState } from '@/components/chat/sticker-panel';
import type { ReplyRef } from '@/lib/types';
import type { MentionMember, UiMention } from '@zilar/chat-core';
import type {
  SendAttachmentOptions,
  SendStickerChoice,
  SendTextOptions,
  SendVoiceRecording,
} from '@/store/types';
import { useChatStore } from '@/store/chat-store-provider';

/**
 * A storage read or write, a server load, a picker or a download rejected.
 * The composer never shows the cause: each step either ignores the failure or
 * shows its own fixed sentence.
 */
class ComposerStepFailed extends Data.TaggedError('ComposerStepFailed')<{
  readonly reason: unknown;
}> {}

/**
 * Lifts one Promise call into an Effect. `run` is called with no argument, so
 * the abort signal never lands in an optional parameter such as the `api` of
 * `loadStickerPacks`.
 */
function step<A>(run: () => Promise<A>): Effect.Effect<A, ComposerStepFailed> {
  return Effect.tryPromise({
    try: () => run(),
    catch: (reason) => new ComposerStepFailed({ reason }),
  });
}

const MIN_INPUT_HEIGHT = 36;
const MAX_INPUT_HEIGHT = 132;

/**
 * The text field height for a reported content height (T-0175): on Android
 * the reported content height already includes the field's `py-2` padding,
 * so adding padding again counted it twice and the composer well grew to
 * about twice its height. An empty one-line field is exactly
 * `MIN_INPUT_HEIGHT` (a 36 px field plus 8 px padding top and bottom makes
 * one empty line about 52 px); the cap holds 8 lines.
 */
export function fieldHeightFor(contentHeight: number): number {
  if (!Number.isFinite(contentHeight)) {
    return MIN_INPUT_HEIGHT;
  }
  return clamp(Math.round(contentHeight), MIN_INPUT_HEIGHT, MAX_INPUT_HEIGHT);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * A mock-mode demo attachment as a picked file. The `gradient:` URL is the
 * preview URI (the bubble renders the gradient placeholder, never a fetch);
 * the store replaces it with the mock served URL on send.
 */
function demoPickedFile(attachment: Attachment): PickedFile {
  return {
    uri: attachment.url,
    name: attachment.name,
    mimeType: attachment.mime,
    size: attachment.size,
    ...(attachment.width === undefined ? {} : { width: attachment.width }),
    ...(attachment.height === undefined ? {} : { height: attachment.height }),
  };
}

function ReplyBar({ reply, onCancel }: { reply: ReplyRef; onCancel: () => void }) {
  return (
    <View className="mb-2 flex-row items-stretch overflow-hidden rounded-[10px]" style={well}>
      <View className="w-[3px] bg-[#333333]" />
      <View className="min-w-0 flex-1 px-2.5 py-1.5">
        <Text className="text-[13px] font-semibold text-[#d4d4d4]">
          Reply to {reply.senderName}
        </Text>
        {reply.text !== undefined ? (
          <Text numberOfLines={1} className="text-[13px] text-muted-foreground">
            {reply.text}
          </Text>
        ) : null}
      </View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Cancel reply"
        onPress={onCancel}
        className="w-9 items-center justify-center active:bg-surface-raised"
      >
        <X size={18} color={ICON} />
      </Pressable>
    </View>
  );
}

type ComposerProps = {
  onSend: (text: string, mentions?: UiMention[]) => void;
  onSendSticker: (sticker: SendStickerChoice) => void;
  /** Sends a picked file with the composer text as the caption (T-0150). */
  onSendAttachment?: ((file: PickedFile, options?: SendAttachmentOptions) => void) | undefined;
  /** Sends a finished voice recording (T-0154). */
  onSendVoice?: ((recording: SendVoiceRecording, options?: SendTextOptions) => void) | undefined;
  /** Demo packs in mock mode, so the panel works without a server. */
  demoPacks?: StickerPack[];
  /** Demo attachments in mock mode, so the flow works without a server. */
  demoAttachments?: Attachment[] | undefined;
  /** Demo GIFs in mock mode, so the GIF flow works without a server. */
  demoGifs?: GifItem[] | undefined;
  replyTo?: ReplyRef;
  onCancelReply: () => void;
  onTyping?: () => void;
  /** Group members (and AIs) for the `@` picker; absent in DMs (T-0227). */
  mentionMembers?: MentionMember[] | undefined;
  /** Used for the `Message <title>` placeholder, like the web composer. */
  title?: string;
  /** The native pickers; tests inject a fake. */
  picker?: AttachmentPicker | undefined;
  /** The GIF media downloader; tests inject a fake. */
  gifDownloader?: GifDownloader | undefined;
  /** The chat behind this composer; a switch resets mention state (T-0227). */
  chatKey?: string | undefined;
};

/** Bottom composer: a well with attach, auto-growing input, emoji and mic/send. */
export function Composer({
  onSend,
  onSendSticker,
  onSendAttachment,
  onSendVoice,
  replyTo,
  onCancelReply,
  onTyping,
  title,
  mentionMembers,
  chatKey,
  demoPacks,
  demoAttachments,
  demoGifs,
  picker: pickerProp,
  gifDownloader: gifDownloaderProp,
}: ComposerProps) {
  const insets = useSafeAreaInsets();
  const { pressed, reduceMotion, setPressed } = useKeyPress();
  const editTarget = useChatStore((state) => state.editTarget);
  const cancelEdit = useChatStore((state) => state.cancelEdit);
  const editMessage = useChatStore((state) => state.editMessage);
  // The target message's text is the initial value; the store keeps the live
  // message under the same id, so the bar never goes stale while editing.
  // An attachment target edits its caption through the same path (T-0157).
  const targetText = useChatStore((state) => {
    const target = state.editTarget;
    if (target === undefined) return undefined;
    return state.messages(target.chatId).find((message) => message.id === target.messageId)?.text;
  });
  const [text, setText] = useState('');
  const [inputHeight, setInputHeight] = useState(MIN_INPUT_HEIGHT);
  // The caret for emoji insertion: tracked from the TextInput's
  // `onSelectionChange`; `undefined` until the first selection event (an
  // emoji pick then appends at the end).
  const [selection, setSelection] = useState<CaretSelection | undefined>(undefined);
  // The `@` mention tracking (T-0227, like web's `mentions` + `picker`): the
  // mention ranges carried with the text, and the open query. Edit mode keeps
  // today's behaviour (no picker while editing). A chat switch resets the
  // tracked mentions through `chatKey` below; the draft text stays.
  const [mentions, setMentions] = useState<UiMention[]>([]);
  const [mentionQuery, setMentionQuery] = useState<{ start: number; query: string } | undefined>(
    undefined,
  );
  // Entering edit mode prefills the input with the message's text; leaving it
  // restores whatever the user had typed before they tapped Edit. The seeding
  // runs while rendering, keyed on the message id (a string), instead of in an
  // effect: a later inbound correction (which only changes `targetText`) does
  // not clobber the user's typing, and no state is set from an effect.
  const editingId =
    editTarget === undefined ? undefined : `${editTarget.chatId}:${editTarget.messageId}`;
  const [seededFor, setSeededFor] = useState<string | undefined>(undefined);
  const [previousDraft, setPreviousDraft] = useState('');
  // The screen passes `chatKey={chat.id}`: a switch resets the tracked
  // mentions and the open query (a picked mention must never leak into
  // another chat, like web), while the draft text stays. Seeding the initial
  // value from `chatKey` skips the reset on the first render.
  const [trackedChatKey, setTrackedChatKey] = useState<string | undefined>(chatKey);
  if (editingId !== seededFor) {
    setSeededFor(editingId);
    if (editingId !== undefined) {
      setPreviousDraft(text);
      setText(targetText ?? '');
    }
  }
  if (chatKey !== undefined && trackedChatKey !== chatKey) {
    const reset = resetMentionStateForChatKey(trackedChatKey, chatKey, {
      mentions,
      query: mentionQuery,
    });
    setTrackedChatKey(reset.trackedChatKey);
    setMentions(reset.state.mentions);
    setMentionQuery(reset.state.query);
  }
  const iconColor = ICON;
  const placeholder = title === undefined ? 'Message' : `Message ${title}`;

  // Attachments (T-0150): the paperclip opens the attach sheet. Picking is
  // owned here (the native picker seam is injected for tests); sending goes
  // through the store's `sendAttachment` with the composer text as the
  // caption, exactly like web. Voice (T-0154): the mic button records through
  // the `VoiceRecorderButton` below and sends through `onSendVoice`.
  const [voiceRecording, setVoiceRecording] = useState(false);
  const [attachOpen, setAttachOpen] = useState(false);
  const [attachError, setAttachError] = useState<string | undefined>(undefined);
  const [picked, setPicked] = useState<PickedFile | undefined>(undefined);
  // Production defaults to the real `expo-file-system` stat for unknown
  // picker sizes (T-0157); tests inject a fake picker.
  const picker = useMemo(() => pickerProp ?? createAttachmentPicker(), [pickerProp]);
  const gifDownloader = useMemo(
    () => gifDownloaderProp ?? createGifDownloader(),
    [gifDownloaderProp],
  );
  // The press handler runs this action, which starts the picker (and so the
  // OS permission prompt) at once; the sheet is busy while it waits.
  const [pickState, pickAttachment] = useAction((choice: AttachmentChoice) =>
    step(() =>
      choice === 'library'
        ? picker.pickImageOrVideo()
        : choice === 'camera'
          ? picker.takePhoto()
          : picker.pickFile(),
    ).pipe(
      Effect.tap((result) =>
        Effect.sync(() => {
          if (result.status === 'cancelled') {
            return;
          }
          if (result.status === 'error') {
            setAttachError(result.message);
            return;
          }
          setPicked(result.file);
        }),
      ),
      Effect.catchTag('ComposerStepFailed', () =>
        Effect.sync(() => setAttachError('Could not pick that file. Try again.')),
      ),
    ),
  );
  const attachBusy = isWaiting(pickState);
  const canSend = text.trim().length > 0 || picked !== undefined;

  // The sticker panel: the user's packs from the server (demo packs in mock
  // mode), a per-device Recent row, tap-to-send. Loading, error + retry, and
  // the "create on web" empty state live in `StickerGrid` (shown inside the
  // emoji sheet's Stickers tab).
  const [packs, setPacks] = useState<StickerPack[] | undefined>(undefined);
  const [panelState, setPanelState] = useState<StickerPanelState>('loading');
  const [recents, setRecents] = useState<RecentStickerEntry[]>([]);
  const [activePackId, setActivePackId] = useState<string | undefined>(undefined);

  // The latest load wins: a Retry while an older load runs replaces it.
  const [, loadPacks] = useAction<void, StickerPack[] | void, never>(
    () =>
      step(() => loadStickerPacks()).pipe(
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
    setActivePackId((current) =>
      current !== undefined && (demoPacks ?? []).some((pack) => pack.id === current)
        ? current
        : undefined,
    );
    if (demoPacks !== undefined) {
      setPacks(demoPacks);
      setPanelState(demoPacks.length === 0 ? 'empty' : 'ready');
      return;
    }
    setPanelState('loading');
    loadPacks();
  }, [demoPacks, loadPacks]);

  // The GIF tab: hidden once the server answers 501 (provider off),
  // probed once per session. Mock mode serves demo GIFs without a server.
  const [gifAvailable, setGifAvailable] = useState<boolean | undefined>(() =>
    demoGifs === undefined ? gifsAvailability() : true,
  );
  const demoGifItems = useMemo(
    () => demoGifs ?? (process.env.EXPO_PUBLIC_ZILAR_MOCK === '1' ? mockDemoGifs() : undefined),
    [demoGifs],
  );

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
            ? step(() => probeGifsAvailability()).pipe(
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
    hydrateSheet(demoGifItems === undefined && gifsAvailability() === undefined);
  };

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
    if (mentionsEnabled) {
      const state = mentionStateForChange(
        text,
        next,
        caret,
        { mentions, query: mentionQuery },
        true,
      );
      setMentions(state.mentions);
      setMentionQuery(state.query);
    }
    rememberEmoji({ recents: emojiRecents, emoji });
  };

  // A GIF pick fetches the media through the proxy, then sends it with the
  // existing attachment path (the composer text is the caption), exactly
  // like web's `sendGif`. The mime and the extension come from the real
  // content type; failures show the inline error, and the attachment
  // bubble's Retry covers upload failures.
  // Every pick runs as its own fiber, so two picks while the first download
  // is still running both send (a shared action would drop or replace one).
  // The handler that sends is inside `Effect.try`, so a throw there shows the
  // same sentence as a failed download. Unmounting interrupts the fibers
  // that are still running.
  const gifFibers = useRef(new Set<Fiber.Fiber<void, never>>());
  useEffect(() => {
    const running = gifFibers.current;
    return () => {
      Effect.runFork(Fiber.interruptAll(running));
      running.clear();
    };
  }, []);

  const sendGif = (gif: GifItem) => {
    const caption = text.trim();
    const send = onSendAttachment;
    const reply = replyTo;
    const fiber = Effect.runFork(
      step(() => gifDownloader.download(gif)).pipe(
        Effect.flatMap((result) =>
          Effect.try({
            try: () => {
              if (result.status !== 'downloaded') {
                setAttachError(result.message);
                return;
              }
              send?.(result.file, {
                ...(caption.length === 0 ? {} : { caption }),
                ...(reply === undefined ? {} : { replyTo: reply }),
              });
              setText('');
              setInputHeight(MIN_INPUT_HEIGHT);
              onCancelReply();
            },
            catch: (reason) => new ComposerStepFailed({ reason }),
          }),
        ),
        Effect.catchTag('ComposerStepFailed', () =>
          Effect.sync(() => setAttachError('Could not load that GIF. Try another.')),
        ),
      ),
    );
    gifFibers.current.add(fiber);
    fiber.addObserver(() => gifFibers.current.delete(fiber));
  };

  const pickGif = (gif: GifItem) => {
    setSheetOpen(false);
    if (onSendAttachment === undefined) {
      return;
    }
    sendGif(gif);
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

  // The `@` mention picker (T-0227, like web): only when the screen passes
  // members (groups, never DMs) and never while editing. Sending and the
  // `chatKey` chat switch below both reset the tracked mentions.
  const mentionsEnabled = mentionMembers !== undefined && editTarget === undefined;
  const candidates =
    mentionsEnabled && mentionQuery !== undefined
      ? mentionCandidates(mentionMembers, { mentions, query: mentionQuery })
      : [];
  const pickerOpen = candidates.length > 0;

  const handleSend = () => {
    // A picked file sends with the composer text as the caption (web sends
    // the same way): the store uploads the bytes, then the attachment
    // message. The sheet closes and the composer clears, like web.
    if (picked !== undefined) {
      if (onSendAttachment !== undefined) {
        const caption = text.trim();
        onSendAttachment(picked, {
          ...(caption.length === 0 ? {} : { caption }),
          ...(replyTo === undefined ? {} : { replyTo }),
        });
      }
      setPicked(undefined);
      setAttachOpen(false);
      setAttachError(undefined);
      onCancelReply();
      setText('');
      setInputHeight(MIN_INPUT_HEIGHT);
      return;
    }
    if (!canSend) {
      return;
    }
    if (editTarget !== undefined) {
      // XEP-0308: replacing the message with a new body sends a correction.
      // The sender id check and the no-op guard live in the store.
      editMessage(editTarget.chatId, editTarget.messageId, text);
      cancelEdit();
      setPreviousDraft('');
      setText('');
      setInputHeight(MIN_INPUT_HEIGHT);
      return;
    }
    onSend(text, mentions.length === 0 ? undefined : [...mentions]);
    setText('');
    setMentions([]);
    setMentionQuery(undefined);
    setInputHeight(MIN_INPUT_HEIGHT);
  };

  const handleCancelEdit = () => {
    cancelEdit();
    setText(previousDraft);
    setPreviousDraft('');
  };

  const openAttach = () => {
    setAttachError(undefined);
    // In mock mode the sheet lists the generated demo attachments, so the
    // flow works without a server; tapping one fills the preview row, and
    // Send uploads it through the mock store like a picked file.
    setAttachOpen(true);
  };

  const closeAttach = () => {
    if (attachBusy) {
      return;
    }
    setAttachOpen(false);
    setAttachError(undefined);
  };

  // One pick attempt from the sheet: permission denials and oversized files
  // show a plain explanation and keep the sheet open; a cancel just closes
  // the busy state. A picked file stays in the sheet as the preview row, and
  // the composer's send button sends it with the caption.
  const chooseAttachment = (choice: AttachmentChoice) => {
    setAttachError(undefined);
    pickAttachment(choice);
  };

  // A demo attachment becomes a picked file: the gradient URL is the
  // preview URI (never fetched), and the store sends the same wire shape.
  const demoPick = (attachment: Attachment) => {
    setAttachError(undefined);
    setPicked(demoPickedFile(attachment));
  };

  const handleChange = (value: string) => {
    // Deleting one character inside or right after a mention removes the
    // whole token, like web's Backspace handler (RN has no reliable
    // `onKeyPress` backspace signal). Only a real single-character delete at
    // a collapsed caret takes the token path (T-0227 M1): a range replace
    // with net −1 is normal typing, or the user's edit would be lost. Any
    // other change retracks the ranges and the picker through the shared
    // helper. The tracked `selection` is the pre-change caret
    // (`onSelectionChange` for this keystroke has not fired yet), so shift
    // it by the length delta to find the post-change caret; tapping a row
    // and emoji insertion set it explicitly.
    const caret = caretAfterChange(text, value, selection?.start);
    if (mentionsEnabled && mentions.length > 0 && isSingleCharBackspace(text, value, selection)) {
      const removed = backspaceMention(
        text,
        selection?.start ?? 0,
        { mentions, query: mentionQuery },
        true,
      );
      if (removed !== undefined) {
        setText(removed.text);
        setMentions(removed.state.mentions);
        setMentionQuery(removed.state.query);
        setSelection({ start: removed.caret, end: removed.caret });
        return;
      }
    }
    setText(value);
    if (mentionsEnabled) {
      const next = mentionStateForChange(
        text,
        value,
        caret,
        { mentions, query: mentionQuery },
        true,
      );
      setMentions(next.mentions);
      setMentionQuery(next.query);
    }
    if (editTarget === undefined && value.trim().length > 0) {
      onTyping?.();
    }
  };

  // Tapping a picker row replaces the `@query` with the token and puts the
  // caret after it, like web's `pickMention`. The native field is controlled
  // by `selection`, so setting it moves the caret on the next render.
  const pickMention = (member: MentionMember) => {
    const caret = selection?.start ?? text.length;
    const picked = pickMentionMember(text, caret, member, { mentions, query: mentionQuery });
    if (picked === undefined) {
      return;
    }
    setText(picked.text);
    setMentions(picked.state.mentions);
    setMentionQuery(undefined);
    setSelection({ start: picked.caret, end: picked.caret });
  };

  return (
    <View className="px-2 pt-1.5" style={{ paddingBottom: Math.max(insets.bottom, 8) }}>
      {editTarget !== undefined ? (
        <EditBar text={targetText ?? ''} onCancel={handleCancelEdit} />
      ) : replyTo !== undefined ? (
        <ReplyBar reply={replyTo} onCancel={onCancelReply} />
      ) : null}
      {attachError !== undefined && !attachOpen ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Dismiss error"
          onPress={() => setAttachError(undefined)}
          className="mb-2 rounded-[10px] px-3 py-2"
          style={well}
        >
          <Text className="text-[13px] text-[#f87171]">{attachError}</Text>
        </Pressable>
      ) : null}
      {pickerOpen ? <MentionPicker members={candidates} onSelect={pickMention} /> : null}
      <View
        className="flex-row items-end gap-1 rounded-[14px] p-2"
        style={[well, { borderColor: '#262626' }]}
      >
        {!voiceRecording ? (
          <>
            <IconButton label="Attach file" className="h-9 w-9 rounded-[10px]" onPress={openAttach}>
              <Paperclip size={20} color={iconColor} />
            </IconButton>
            <TextInput
              value={text}
              onChangeText={handleChange}
              multiline
              placeholder={placeholder}
              placeholderTextColor="#a1a1a1"
              accessibilityLabel="Message"
              className="mx-1 flex-1 py-2 text-[16px] text-foreground"
              style={{ height: inputHeight, maxHeight: MAX_INPUT_HEIGHT, lineHeight: 20 }}
              selection={selection}
              onContentSizeChange={(event) =>
                setInputHeight(fieldHeightFor(event.nativeEvent.contentSize.height))
              }
              onSelectionChange={(event) =>
                setSelection({
                  start: event.nativeEvent.selection.start,
                  end: event.nativeEvent.selection.end,
                })
              }
            />
            <IconButton label="Emoji" className="h-9 w-9 rounded-[10px]" onPress={openSheet}>
              <Smile size={20} color={iconColor} />
            </IconButton>
          </>
        ) : null}
        {canSend ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={editTarget !== undefined ? 'Save edit' : 'Send message'}
            onPress={handleSend}
            onPressIn={() => setPressed(true)}
            onPressOut={() => setPressed(false)}
            className="h-9 w-9 items-center justify-center rounded-[10px]"
            style={[primaryKey, pressStyle(pressed, KEY_PRIMARY_PRESSED_SHADOW, reduceMotion)]}
          >
            <ArrowUp size={20} color={ACCENT_FOREGROUND} />
          </Pressable>
        ) : (
          <VoiceRecorderButton
            onSendVoice={(recording, options) => onSendVoice?.(recording, options)}
            replyTo={replyTo}
            onCancelReply={onCancelReply}
            canSend={canSend}
            onRecordingChange={setVoiceRecording}
          />
        )}
      </View>
      <EmojiSheet
        open={sheetOpen}
        tab={sheetTab}
        onSelectTab={setSheetTab}
        gifsVisible={gifAvailable !== false}
        emojiRecents={emojiRecents}
        emojiCategory={emojiCategory}
        onSelectEmojiCategory={setEmojiCategory}
        onPickEmoji={pickEmoji}
        packs={packs}
        panelState={panelState}
        stickerRecents={recents}
        activePackId={activePackId}
        onSelectPack={setActivePackId}
        onPickSticker={pickSticker}
        onRetryStickers={loadPanel}
        mockGifItems={demoGifItems}
        onPickGif={pickGif}
        onClose={() => setSheetOpen(false)}
      />
      <AttachSheet
        open={attachOpen}
        busy={attachBusy}
        error={attachError}
        preview={
          picked === undefined
            ? undefined
            : { uri: picked.uri, name: picked.name, size: picked.size }
        }
        demoAttachments={demoAttachments}
        onPick={chooseAttachment}
        onPickDemo={demoAttachments === undefined ? undefined : demoPick}
        onCancelPick={
          picked === undefined
            ? undefined
            : () => {
                setPicked(undefined);
              }
        }
        onClose={closeAttach}
      />
    </View>
  );
}
