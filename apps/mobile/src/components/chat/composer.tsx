import type { Attachment } from '@zilar/protocol';
import {
  composerPlaceholder,
  isAiJid,
  lightToPlain,
  type MentionMember,
  type UiMention,
} from '@zilar/chat-core';
import { ArrowUp, Check, Keyboard, Paperclip, Pencil, Smile, X } from 'lucide-react-native';
import { useEffect, useRef, useState, useCallback } from 'react';
import { Pressable, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AttachSheet } from '@/components/chat/attach-sheet';
import { useComposerMedia } from '@/components/chat/composer-media';
import { PickedStrip } from '@/components/chat/composer-picked-strip';
import { useComposerSheet } from '@/components/chat/composer-sheet';
import { EmojiSheet } from '@/components/chat/emoji-sheet';
import { tap } from '@/components/chat/haptics';
import { useComposerMentions } from '@/components/chat/use-composer-mentions';
import { useBackCancel } from '@/components/chat/use-back-cancel';
import { VoiceRecorderButton } from '@/components/chat/voice-recorder';
import { AiBadge } from '@/components/chat/ai-badge';
import { EntityAvatar } from '@/components/chat/entity-avatar';
import { IconButton } from '@/components/ui/icon-button';
import { Text } from '@/components/ui/text';
import { useKeyPress } from '@/components/ui/use-key-press';
import type { AttachmentPicker, GifDownloader, PickedFile } from '@/lib/attachment-ports';
import { ICON } from '@/lib/colors';
import {
  ACCENT_FOREGROUND,
  KEY_PRIMARY_PRESSED_SHADOW,
  pressStyle,
  primaryKey,
  well,
} from '@/lib/depth';
import type { CaretSelection } from '@/lib/emoji-data';
import type { GifsApi } from '@/lib/gifs-api';
import type { StickersApi } from '@/lib/stickers-api';
import type { ReplyRef } from '@/lib/types';
import {
  type SendAttachmentOptions,
  type SendStickerChoice,
  type SendTextOptions,
  type SendVoiceRecording,
} from '@/store/types';
import { useChatStore } from '@/store/chat-store-provider';
import { setDraft, useComposerDraft } from '@/lib/composer-drafts';

interface MentionPickerProps {
  members: MentionMember[];
  onSelect: (member: MentionMember) => void;
}

// The `@` member picker above a group composer, the mobile twin of web's `MentionPicker`: rows are tapped (no hardware-key navigation), and the caller filters and caps them.
function MentionPicker({ members, onSelect }: MentionPickerProps) {
  return (
    <View
      accessibilityRole="list"
      accessibilityLabel="Mention someone"
      className="mb-2 overflow-hidden rounded-[16px] border border-[#1f1f1f] bg-[#111111] pt-1.5 pb-1.5"
      style={{ boxShadow: '0 12px 28px -8px rgba(0,0,0,.95)' }}
    >
      {members.map((member) => {
        const ai = isAiJid(member.jid);
        const hasHandle = member.handle !== undefined && member.handle !== '';
        const label = hasHandle
          ? `Mention ${member.name} @${member.handle}`
          : `Mention ${member.name}`;
        return (
          <Pressable
            key={member.jid}
            accessibilityRole="button"
            accessibilityLabel={label}
            onPress={() => onSelect(member)}
            className="min-h-[48px] w-full flex-row items-center gap-3 pl-[14px] pr-[10px] active:bg-surface-raised"
          >
            <EntityAvatar person={{ id: member.jid, name: member.name }} ai={ai} size={30} />
            <View className="min-w-0 flex-1 flex-row items-center gap-1.5">
              <Text numberOfLines={1} className="min-w-0 shrink text-[16px] text-foreground">
                {member.name}
              </Text>
              {ai ? <AiBadge /> : null}
            </View>
            {hasHandle ? (
              <Text numberOfLines={1} className="shrink-0 font-mono text-[12px] text-[#8a8a8a]">
                @{member.handle}
              </Text>
            ) : null}
          </Pressable>
        );
      })}
    </View>
  );
}

function EditBar({ text, onCancel }: { text: string; onCancel: () => void }) {
  useBackCancel(onCancel);

  return (
    <View className="mb-2 flex-row items-stretch overflow-hidden rounded-[10px]" style={well}>
      <View className="w-[3px] bg-[#333333]" />
      <View className="min-w-0 flex-1 px-2.5 py-1.5">
        <View className="flex-row items-center gap-1.5">
          <Pencil size={14} color="#d4d4d4" />
          <Text className="text-[13px] font-semibold text-[#d4d4d4]">Edit message</Text>
        </View>
        <Text numberOfLines={1} className="text-[13px] text-muted-foreground">
          {text}
        </Text>
      </View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Cancel edit"
        onPress={onCancel}
        className="w-9 items-center justify-center active:bg-surface-raised"
      >
        <X size={18} color={ICON} />
      </Pressable>
    </View>
  );
}

export const MIN_INPUT_HEIGHT = 36;
const MAX_INPUT_HEIGHT = 132;

/** On Android the reported content height already includes the `py-2` padding,
 *  so adding it again doubled the well. The cap holds 8 lines. */
export function fieldHeightFor(contentHeight: number): number {
  if (!Number.isFinite(contentHeight)) {
    return MIN_INPUT_HEIGHT;
  }
  return clamp(Math.round(contentHeight), MIN_INPUT_HEIGHT, MAX_INPUT_HEIGHT);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function ReplyBar({ reply, onCancel }: { reply: ReplyRef; onCancel: () => void }) {
  useBackCancel(onCancel);

  return (
    <View className="mb-2 flex-row items-stretch overflow-hidden rounded-[10px]" style={well}>
      <View className="w-[3px] bg-[#333333]" />
      <View className="min-w-0 flex-1 px-2.5 py-1.5">
        <Text className="text-[13px] font-semibold text-[#d4d4d4]">
          Reply to {reply.senderName}
        </Text>
        {reply.text !== undefined ? (
          <Text numberOfLines={1} className="text-[13px] text-muted-foreground">
            {lightToPlain(reply.text)}
          </Text>
        ) : null}
      </View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Cancel reply"
        hitSlop={8}
        onPress={onCancel}
        className="w-9 items-center justify-center active:bg-surface-raised"
      >
        <X size={18} color={ICON} />
      </Pressable>
    </View>
  );
}

// The composer's text for one chat: the chat's stored draft, so leaving and returning keeps it, and every change writes back through `setDraft` (empty deletes it). A composer with no chat id keeps its text locally.
function useDraftText(chatId: string | undefined): [string, (next: string) => void] {
  const stored = useComposerDraft(chatId);
  const [local, setLocal] = useState('');
  const setValue = useCallback(
    (next: string): void => {
      if (chatId === undefined) {
        setLocal(next);
        return;
      }
      setDraft(chatId, next);
    },
    [chatId],
  );
  return chatId === undefined ? [local, setValue] : [stored, setValue];
}

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

  const { pressed, reduceMotion, setPressed } = useKeyPress();
  const iconColor = ICON;
  const sendLabel = editing
    ? 'Save edit'
    : media.picks.length >= 2
      ? `Send ${media.picks.length} files`
      : 'Send message';
  const showKeyboard = () => {
    sheet.closeSheet();
    inputRef.current?.focus();
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
      <View
        className="flex-row items-end gap-1 rounded-[14px] p-2"
        style={[well, { borderColor: '#262626' }]}
      >
        {!media.voiceRecording ? (
          <>
            <IconButton
              label="Attach file"
              className="h-9 w-9 rounded-[10px]"
              onPress={media.openAttach}
            >
              <Paperclip size={20} color={iconColor} />
            </IconButton>
            <TextInput
              ref={inputRef}
              value={text}
              onChangeText={mentions.handleChange}
              multiline
              placeholder={placeholder}
              placeholderTextColor="#a1a1a1"
              accessibilityLabel="Message"
              className="mx-1 flex-1 py-2 text-[16px] text-foreground"
              style={{ height: inputHeight, maxHeight: MAX_INPUT_HEIGHT, lineHeight: 20 }}
              selection={selection}
              onFocus={() => {
                if (sheet.sheetOpen) {
                  sheet.closeSheet();
                }
              }}
              onContentSizeChange={(event) =>
                setInputHeight(
                  text === ''
                    ? MIN_INPUT_HEIGHT
                    : fieldHeightFor(event.nativeEvent.contentSize.height),
                )
              }
              onSelectionChange={(event) =>
                setSelection({
                  start: event.nativeEvent.selection.start,
                  end: event.nativeEvent.selection.end,
                })
              }
            />
            <IconButton
              label={sheet.sheetOpen ? 'Keyboard' : 'Emoji'}
              className="h-9 w-9 rounded-[10px]"
              onPress={sheet.sheetOpen ? showKeyboard : sheet.openSheet}
            >
              {sheet.sheetOpen ? (
                <Keyboard size={20} color={iconColor} />
              ) : (
                <Smile size={20} color={iconColor} />
              )}
            </IconButton>
          </>
        ) : null}
        {media.canSend ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={sendLabel}
            hitSlop={8}
            onPress={() => {
              tap();
              handleSend();
            }}
            onPressIn={() => setPressed(true)}
            onPressOut={() => setPressed(false)}
            className="h-9 w-9 items-center justify-center rounded-[10px]"
            style={[primaryKey, pressStyle(pressed, KEY_PRIMARY_PRESSED_SHADOW, reduceMotion)]}
          >
            {editing ? (
              <Check size={20} color={ACCENT_FOREGROUND} />
            ) : (
              <ArrowUp size={20} color={ACCENT_FOREGROUND} />
            )}
          </Pressable>
        ) : (
          <VoiceRecorderButton
            onSendVoice={(recording, options) => onSendVoice?.(recording, options)}
            replyTo={replyTo}
            onCancelReply={onCancelReply}
            canSend={media.canSend}
            onRecordingChange={media.setVoiceRecording}
          />
        )}
      </View>
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
