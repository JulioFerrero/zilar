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
  onSendAttachment?: ((file: PickedFile, options?: SendAttachmentOptions) => void) | undefined;
  onSendVoice?: ((recording: SendVoiceRecording, options?: SendTextOptions) => void) | undefined;
  stickersApi?: StickersApi | undefined;
  demoAttachments?: Attachment[] | undefined;
  gifsApi?: GifsApi | undefined;
  replyTo?: ReplyRef;
  onCancelReply: () => void;
  onTyping?: () => void;
  onStopTyping?: () => void;
  mentionMembers?: MentionMember[] | undefined;
  title?: string;
  picker?: AttachmentPicker | undefined;
  gifDownloader?: GifDownloader | undefined;
  chatKey?: string | undefined;
};

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
  const targetText = useChatStore((state) => {
    const target = state.editTarget;
    if (target === undefined) return undefined;
    return state.messages(target.chatId).find((message) => message.id === target.messageId)?.text;
  });
  const editing = editTarget !== undefined;
  const [draftText, setDraftText] = useDraftText(chatKey);
  const [editText, setEditText] = useState('');
  const text = editing ? editText : draftText;
  const setText = editing ? setEditText : setDraftText;
  const typingActiveRef = useRef(false);
  const [inputHeight, setInputHeight] = useState(MIN_INPUT_HEIGHT);
  const [selection, setSelection] = useState<CaretSelection | undefined>(undefined);
  const editingId =
    editTarget === undefined ? undefined : `${editTarget.chatId}:${editTarget.messageId}`;
  const [seededFor, setSeededFor] = useState<string | undefined>(undefined);
  if (editingId !== seededFor) {
    setSeededFor(editingId);
    const seed = editingId === undefined ? '' : (targetText ?? '');
    setEditText(seed);
    setSelection(editingId === undefined ? undefined : { start: seed.length, end: seed.length });
  }

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

  const placeholder = media.picks.length > 0 ? 'Add a caption' : composerPlaceholder(title);
  const pickedPreviews = media.picks.map((file) => ({
    uri: file.uri,
    name: file.name,
    size: file.size,
    mimeType: file.mimeType,
  }));

  const handleSend = () => {
    if (media.sendPicked()) {
      return;
    }
    if (!media.canSend) {
      return;
    }
    if (editTarget !== undefined) {
      // XEP-0308: replacing the body sends a correction. The draft stays stored, so
      // leaving edit mode brings it back.
      editMessage(editTarget.chatId, editTarget.messageId, text);
      cancelEdit();
      setInputHeight(MIN_INPUT_HEIGHT);
      return;
    }
    onSend(text, mentions.mentions.length === 0 ? undefined : [...mentions.mentions]);
    // The dock already sent the paused stanza; drop the flag so the effect sends no second one.
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
        sheetOpen={sheet.sheetOpen}
        onCloseSheet={sheet.closeSheet}
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
