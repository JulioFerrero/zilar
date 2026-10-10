import { type Attachment } from '@zilar/protocol';
import { useState } from 'react';
import { Pressable, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AttachSheet } from '@/components/chat/attach-sheet';
import { ComposerInputRow, MIN_INPUT_HEIGHT, ReplyBar } from '@/components/chat/composer-input-row';
import { useComposerMedia } from '@/components/chat/composer-media';
import { useComposerSheet } from '@/components/chat/composer-sheet';
import { EditBar } from '@/components/chat/edit-bar';
import { EmojiSheet } from '@/components/chat/emoji-sheet';
import { MentionPicker } from '@/components/chat/mention-picker';
import { useComposerMentions } from '@/components/chat/use-composer-mentions';
import { Text } from '@/components/ui/text';
import type { AttachmentPicker, GifDownloader, PickedFile } from '@/lib/attachment-ports';
import { well } from '@/lib/depth';
import type { CaretSelection } from '@/lib/emoji-data';
import type { GifItem } from '@/lib/gifs';
import type { StickerPack } from '@/lib/stickers';
import type { ReplyRef } from '@/lib/types';
import type { MentionMember, UiMention } from '@zilar/chat-core';
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
  // Entering edit mode prefills the input with the message's text; leaving it
  // restores whatever the user had typed before they tapped Edit. The seeding
  // runs while rendering, keyed on the message id (a string), instead of in an
  // effect: a later inbound correction (which only changes `targetText`) does
  // not clobber the user's typing, and no state is set from an effect.
  const editingId =
    editTarget === undefined ? undefined : `${editTarget.chatId}:${editTarget.messageId}`;
  const [seededFor, setSeededFor] = useState<string | undefined>(undefined);
  const [previousDraft, setPreviousDraft] = useState('');
  if (editingId !== seededFor) {
    setSeededFor(editingId);
    if (editingId !== undefined) {
      setPreviousDraft(text);
      setText(targetText ?? '');
    }
  }

  const mentions = useComposerMentions({
    chatKey,
    mentionMembers,
    editing: editTarget !== undefined,
    text,
    setText,
    selection,
    setSelection,
    onTyping,
  });

  const sheet = useComposerSheet({
    text,
    setText,
    selection,
    setSelection,
    demoPacks,
    demoGifs,
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

  const placeholder = title === undefined ? 'Message' : `Message ${title}`;

  const handleSend = () => {
    // A picked file sends with the composer text as the caption (web sends
    // the same way): the store uploads the bytes, then the attachment
    // message. The sheet closes and the composer clears, like web.
    if (media.sendPicked()) {
      return;
    }
    if (!media.canSend) {
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
    onSend(text, mentions.mentions.length === 0 ? undefined : [...mentions.mentions]);
    setText('');
    mentions.clearMentions();
    setInputHeight(MIN_INPUT_HEIGHT);
  };

  const handleCancelEdit = () => {
    cancelEdit();
    setText(previousDraft);
    setPreviousDraft('');
  };

  return (
    <View className="px-2 pt-1.5" style={{ paddingBottom: Math.max(insets.bottom, 8) }}>
      {editTarget !== undefined ? (
        <EditBar text={targetText ?? ''} onCancel={handleCancelEdit} />
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
      <ComposerInputRow
        placeholder={placeholder}
        text={text}
        onChangeText={mentions.handleChange}
        selection={selection}
        onSelectionChange={setSelection}
        inputHeight={inputHeight}
        onInputHeightChange={setInputHeight}
        canSend={media.canSend}
        editing={editTarget !== undefined}
        onSend={handleSend}
        onOpenAttach={media.openAttach}
        onOpenSheet={sheet.openSheet}
        voiceRecording={media.voiceRecording}
        onRecordingChange={media.setVoiceRecording}
        replyTo={replyTo}
        onCancelReply={onCancelReply}
        onSendVoice={onSendVoice}
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
        mockGifItems={sheet.demoGifItems}
        onPickGif={media.pickGif}
        onClose={sheet.closeSheet}
      />
      <AttachSheet
        open={media.attachOpen}
        busy={media.attachBusy}
        error={media.attachError}
        preview={
          media.picked === undefined
            ? undefined
            : { uri: media.picked.uri, name: media.picked.name, size: media.picked.size }
        }
        demoAttachments={demoAttachments}
        onPick={media.chooseAttachment}
        onPickDemo={demoAttachments === undefined ? undefined : media.demoPick}
        onCancelPick={
          media.picked === undefined
            ? undefined
            : () => {
                media.setPicked(undefined);
              }
        }
        onClose={media.closeAttach}
      />
    </View>
  );
}
