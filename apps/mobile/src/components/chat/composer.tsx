import { type Attachment } from '@zilar/protocol';
import { useEffect, useRef, useState } from 'react';
import { Pressable, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AttachSheet } from '@/components/chat/attach-sheet';
import { ComposerInputRow, MIN_INPUT_HEIGHT, ReplyBar } from '@/components/chat/composer-input-row';
import { useComposerMedia } from '@/components/chat/composer-media';
import { PickedStrip } from '@/components/chat/composer-picked-strip';
import { useComposerSheet } from '@/components/chat/composer-sheet';
import { EditBar } from '@/components/chat/edit-bar';
import { EmojiSheet } from '@/components/chat/emoji-sheet';
import { MentionPicker } from '@/components/chat/mention-picker';
import { useComposerMentions } from '@/components/chat/use-composer-mentions';
import { useDraftText } from '@/components/chat/use-draft-text';
import { Text } from '@/components/ui/text';
import type { AttachmentPicker, GifDownloader, PickedFile } from '@/lib/attachment-ports';
import { well } from '@/lib/depth';
import type { CaretSelection } from '@/lib/emoji-data';
import type { GifsApi } from '@/lib/gifs-api';
import type { StickersApi } from '@/lib/stickers-api';
import type { ReplyRef } from '@/lib/types';
import { composerPlaceholder, type MentionMember, type UiMention } from '@zilar/chat-core';
import type {
  SendAttachmentOptions,
  SendStickerChoice,
  SendTextOptions,
  SendVoiceRecording,
} from '@/store/types';
import { useChatStore } from '@/store/chat-store-provider';

export { fieldHeightFor } from '@/components/chat/composer-input-row';

type ComposerProps = {
  onSend: (text: string, mentions?: UiMention[]) => void;
  onSendSticker: (sticker: SendStickerChoice) => void;
  /** Sends a picked file with the composer text as the caption (T-0150). */
  onSendAttachment?: ((file: PickedFile, options?: SendAttachmentOptions) => void) | undefined;
  /** Sends a finished voice recording (T-0154). */
  onSendVoice?: ((recording: SendVoiceRecording, options?: SendTextOptions) => void) | undefined;
  /** The sticker panel's API client; mock mode injects the shared backend. */
  stickersApi?: StickersApi | undefined;
  /** Demo attachments in mock mode, so the flow works without a server. */
  demoAttachments?: Attachment[] | undefined;
  /** The GIF panel's API client; mock mode injects the shared backend. */
  gifsApi?: GifsApi | undefined;
  replyTo?: ReplyRef;
  onCancelReply: () => void;
  onTyping?: () => void;
  /** Called when the text empties or a send clears it (T-1149). */
  onStopTyping?: () => void;
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
  onStopTyping,
  title,
  mentionMembers,
  chatKey,
  stickersApi,
  demoAttachments,
  gifsApi,
  picker: pickerProp,
  gifDownloader: gifDownloaderProp,
}: ComposerProps) {
  const insets = useSafeAreaInsets();
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
  // The text is the chat's stored draft (T-1181): leaving the chat and coming
  // back keeps it, and the chat row can show it. Editing a message shows that
  // message's text in its place and leaves the draft stored, so cancelling the
  // edit brings the draft back untouched.
  const editing = editTarget !== undefined;
  const [draftText, setDraftText] = useDraftText(chatKey);
  const [editText, setEditText] = useState('');
  const text = editing ? editText : draftText;
  const setText = editing ? setEditText : setDraftText;
  // Whether a composing event was sent for the current text: the emptiness
  // effect below only stops a line we actually started (T-1149).
  const typingActiveRef = useRef(false);
  const [inputHeight, setInputHeight] = useState(MIN_INPUT_HEIGHT);
  // The caret for emoji insertion: tracked from the TextInput's
  // `onSelectionChange`; `undefined` until the first selection event (an
  // emoji pick then appends at the end).
  const [selection, setSelection] = useState<CaretSelection | undefined>(undefined);
  // Entering edit mode prefills the input with the message's text; leaving it
  // drops the edit text so the stored draft shows again. The seeding runs while
  // rendering, keyed on the message id (a string), instead of in an effect: a
  // later inbound correction (which only changes `targetText`) does not clobber
  // the user's typing, and no state is set from an effect.
  const editingId =
    editTarget === undefined ? undefined : `${editTarget.chatId}:${editTarget.messageId}`;
  const [seededFor, setSeededFor] = useState<string | undefined>(undefined);
  if (editingId !== seededFor) {
    setSeededFor(editingId);
    const seed = editingId === undefined ? '' : (targetText ?? '');
    setEditText(seed);
    // The caret goes to the end of the seeded text, as in Telegram (T-1482).
    setSelection(editingId === undefined ? undefined : { start: seed.length, end: seed.length });
  }

  // Reply and Edit focus the composer, as in Telegram (T-1482): the effect is
  // keyed on the reply's message id and the edit key.
  const inputRef = useRef<TextInput>(null);
  const replyId = replyTo?.id;
  useEffect(() => {
    if (replyId === undefined && editingId === undefined) {
      return;
    }
    inputRef.current?.focus();
  }, [replyId, editingId]);

  const mentions = useComposerMentions({
    chatKey,
    mentionMembers,
    editing: editTarget !== undefined,
    text,
    setText,
    selection,
    setSelection,
    onTyping:
      onTyping === undefined
        ? undefined
        : () => {
            typingActiveRef.current = true;
            onTyping();
          },
  });

  // The line stops as soon as the text empties, whether the last keystroke
  // removed it or a send cleared the composer (T-1149).
  useEffect(() => {
    if (text.trim().length > 0 || !typingActiveRef.current) {
      return;
    }
    typingActiveRef.current = false;
    onStopTyping?.();
  }, [text, onStopTyping]);

  const sheet = useComposerSheet({
    text,
    setText,
    selection,
    setSelection,
    stickersApi,
    gifsApi,
    onSendSticker,
    trackEmojiChange: mentions.trackEmojiChange,
  });

  // The shared clear after an attachment send (web clears the same way): the
  // caption path in `handleSend` and the GIF path in `useComposerMedia` both
  // use it.
  const clearDraft = () => {
    setText('');
    setInputHeight(MIN_INPUT_HEIGHT);
    onCancelReply();
  };

  const media = useComposerMedia({
    text,
    replyTo,
    onSendAttachment,
    picker: pickerProp,
    gifDownloader: gifDownloaderProp,
    clearDraft,
    onCloseSheet: sheet.closeSheet,
  });

  // With staged files the input takes the caption (T-1536); the chat's own
  // placeholder shows otherwise.
  const placeholder = media.picks.length > 0 ? 'Add a caption' : composerPlaceholder(title);
  // The staged files as the strip renders them: a thumbnail, the name, the
  // size and the MIME type, in the order the user picked them (T-1246).
  const pickedPreviews = media.picks.map((file) => ({
    uri: file.uri,
    name: file.name,
    size: file.size,
    mimeType: file.mimeType,
  }));

  const handleSend = () => {
    // The staged files send one message each, the text as the first item's
    // caption (web sends the same way): the store uploads the bytes, then
    // the attachment message. The strip clears and the composer clears.
    if (media.sendPicked()) {
      return;
    }
    if (!media.canSend) {
      return;
    }
    if (editTarget !== undefined) {
      // XEP-0308: replacing the message with a new body sends a correction.
      // The sender id check and the no-op guard live in the store. The draft is
      // left stored, so leaving edit mode brings it back.
      editMessage(editTarget.chatId, editTarget.messageId, text);
      cancelEdit();
      setInputHeight(MIN_INPUT_HEIGHT);
      return;
    }
    onSend(text, mentions.mentions.length === 0 ? undefined : [...mentions.mentions]);
    // The dock already sent the paused stanza with the message; drop the flag
    // so the emptiness effect does not send a second one.
    typingActiveRef.current = false;
    setText('');
    mentions.clearMentions();
    setInputHeight(MIN_INPUT_HEIGHT);
  };

  return (
    <View className="px-2 pt-1.5" style={{ paddingBottom: Math.max(insets.bottom, 8) }}>
      {editTarget !== undefined ? (
        <EditBar text={targetText ?? ''} onCancel={cancelEdit} />
      ) : replyTo !== undefined ? (
        <ReplyBar reply={replyTo} onCancel={onCancelReply} />
      ) : null}
      {media.attachError !== undefined && !media.attachOpen ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Dismiss error"
          onPress={() => media.setAttachError(undefined)}
          className="mb-2 rounded-[10px] px-3 py-2"
          style={well}
        >
          <Text className="text-[13px] text-[#f87171]">{media.attachError}</Text>
        </Pressable>
      ) : null}
      {mentions.pickerOpen ? (
        <MentionPicker members={mentions.candidates} onSelect={mentions.pickMention} />
      ) : null}
      <PickedStrip previews={pickedPreviews} onRemove={media.removePick} />
      <ComposerInputRow
        placeholder={placeholder}
        text={text}
        onChangeText={mentions.handleChange}
        selection={selection}
        onSelectionChange={setSelection}
        inputHeight={inputHeight}
        onInputHeightChange={(height) => setInputHeight(text === '' ? MIN_INPUT_HEIGHT : height)}
        canSend={media.canSend}
        stagedCount={media.picks.length}
        editing={editTarget !== undefined}
        onSend={handleSend}
        onOpenAttach={media.openAttach}
        onOpenSheet={sheet.openSheet}
        voiceRecording={media.voiceRecording}
        onRecordingChange={media.setVoiceRecording}
        replyTo={replyTo}
        onCancelReply={onCancelReply}
        onSendVoice={onSendVoice}
        inputRef={inputRef}
      />
      <EmojiSheet
        open={sheet.sheetOpen}
        tab={sheet.sheetTab}
        onSelectTab={sheet.setSheetTab}
        gifsVisible={sheet.gifAvailable !== false}
        emojiRecents={sheet.emojiRecents}
        emojiCategory={sheet.emojiCategory}
        onSelectEmojiCategory={sheet.setEmojiCategory}
        onPickEmoji={sheet.pickEmoji}
        packs={sheet.packs}
        panelState={sheet.panelState}
        stickerRecents={sheet.recents}
        activePackId={sheet.activePackId}
        onSelectPack={sheet.setActivePackId}
        onPickSticker={sheet.pickSticker}
        onRetryStickers={sheet.loadPanel}
        gifsApi={gifsApi}
        onPickGif={media.pickGif}
        onClose={sheet.closeSheet}
      />
      <AttachSheet
        open={media.attachOpen}
        busy={media.attachBusy}
        error={media.attachError}
        demoAttachments={demoAttachments}
        onPick={media.chooseAttachment}
        onPickDemo={demoAttachments === undefined ? undefined : media.demoPick}
        onSendFiles={media.sendFiles}
        onClose={media.closeAttach}
      />
    </View>
  );
}
