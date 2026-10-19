import type { Attachment } from '@zilar/protocol';
import {
  composerPlaceholder,
  isAiJid,
  lightToPlain,
  type MentionMember,
  type UiMention,
} from '@zilar/chat-core';
import {
  ArrowUp,
  Check,
  Film,
  Keyboard,
  Paperclip,
  Pencil,
  Smile,
  Sticker as StickerIcon,
  X,
  type LucideIcon,
} from 'lucide-react-native';
import { useEffect, useRef, useState, useCallback } from 'react';
import { Pressable, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AttachSheet } from '@/components/chat/attach-sheet';
import { useComposerMedia } from '@/components/chat/composer-media';
import { PickedStrip } from '@/components/chat/composer-picked-strip';
import { useComposerSheet, type EmojiSheetTab } from '@/components/chat/composer-sheet';
import {
  backspaceMention,
  caretAfterChange,
  isSingleCharBackspace,
  mentionCandidates,
  mentionStateForChange,
  pickMentionMember,
  resetMentionStateForChatKey,
} from '@/components/chat/composer-mentions';
import { EmojiTab } from '@/components/chat/emoji-tab';
import { GifPanel } from '@/components/chat/gif-panel';
import { tap } from '@/components/chat/haptics';
import { StickerGrid } from '@/components/chat/sticker-panel';
import { useBackCancel } from '@/components/chat/use-back-cancel';
import { VoiceRecorderButton } from '@/components/chat/voice-recorder';
import { AiBadge } from '@/components/chat/ai-badge';
import { EntityAvatar } from '@/components/chat/entity-avatar';
import { IconButton } from '@/components/ui/icon-button';
import { SegmentedControl } from '@/components/ui/segmented-control';
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

const PANEL_HEIGHT = 320;

function resolveSheetTab(
  remembered: EmojiSheetTab | undefined,
  gifsVisible: boolean,
): EmojiSheetTab {
  if (remembered === 'gifs' && !gifsVisible) {
    return 'emoji';
  }
  return remembered ?? 'emoji';
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

  const notifyTyping =
    onTyping === undefined
      ? undefined
      : () => {
          typingActiveRef.current = true;
          onTyping();
        };

  const [mentions, setMentions] = useState<UiMention[]>([]);
  const [mentionQuery, setMentionQuery] = useState<{ start: number; query: string } | undefined>(
    undefined,
  );
  // A chat switch resets the mentions and query (a picked mention must never leak into another chat) but keeps the draft; seeding from `chatKey` skips the reset on the first render.
  const [trackedChatKey, setTrackedChatKey] = useState<string | undefined>(chatKey);
  if (chatKey !== undefined && trackedChatKey !== chatKey) {
    const reset = resetMentionStateForChatKey(trackedChatKey, chatKey, {
      mentions,
      query: mentionQuery,
    });
    setTrackedChatKey(reset.trackedChatKey);
    setMentions(reset.state.mentions);
    setMentionQuery(reset.state.query);
  }

  // The picker appears only when the screen passes members (groups, never DMs) and never while editing.
  const mentionsEnabled = mentionMembers !== undefined && editTarget === undefined;
  const candidates =
    mentionsEnabled && mentionQuery !== undefined
      ? mentionCandidates(mentionMembers, { mentions, query: mentionQuery })
      : [];
  const pickerOpen = candidates.length > 0;

  const handleChange = (value: string) => {
    // Deleting one character inside or right after a mention removes the whole token, like web (RN has no reliable backspace signal). Only a single-character delete at a collapsed caret takes that path; any other change retracks the ranges.
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
      notifyTyping?.();
    }
  };

  // A picker row replaces the `@query` with the token and puts the caret after it; the field is controlled by `selection`.
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

  const trackEmojiChange = (previousText: string, nextText: string, caret: number) => {
    if (!mentionsEnabled) {
      return;
    }
    const state = mentionStateForChange(
      previousText,
      nextText,
      caret,
      { mentions, query: mentionQuery },
      true,
    );
    setMentions(state.mentions);
    setMentionQuery(state.query);
  };

  const clearMentions = () => {
    setMentions([]);
    setMentionQuery(undefined);
  };

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
    trackEmojiChange,
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
    onSend(text, mentions.length === 0 ? undefined : [...mentions]);
    // The dock already sent the paused stanza; drop the flag so the effect sends no second one.
    typingActiveRef.current = false;
    setText('');
    clearMentions();
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
  const visible = resolveSheetTab(sheet.sheetTab, sheet.gifAvailable !== false);
  const tabs: { id: EmojiSheetTab; label: string; icon: LucideIcon }[] = [
    { id: 'emoji', label: 'Emoji', icon: Smile },
    { id: 'stickers', label: 'Stickers', icon: StickerIcon },
    ...(sheet.gifAvailable !== false ? [{ id: 'gifs' as const, label: 'GIFs', icon: Film }] : []),
  ];

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
      {pickerOpen ? <MentionPicker members={candidates} onSelect={pickMention} /> : null}
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
              onChangeText={handleChange}
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
      {sheet.sheetOpen ? (
        <View
          accessibilityRole="menu"
          accessibilityLabel="Emoji, stickers and GIFs"
          className="mt-1.5 border-t border-border bg-surface px-3 pt-2"
          style={{ height: PANEL_HEIGHT }}
        >
          <View className="pb-2">
            <SegmentedControl
              accessibilityLabel="Panel tabs"
              options={tabs.map((item) => ({
                value: item.id,
                label: item.label,
                icon: item.icon,
              }))}
              value={visible}
              onChange={(value) => {
                const next = tabs.find((item) => item.id === value);
                if (next !== undefined) {
                  sheet.setSheetTab(next.id);
                }
              }}
            />
          </View>
          <View className="min-h-0 flex-1">
            {visible === 'emoji' ? (
              <EmojiTab
                open={sheet.sheetOpen}
                recents={sheet.emojiRecents}
                activeCategory={sheet.emojiCategory}
                onSelectCategory={sheet.setEmojiCategory}
                onPick={sheet.pickEmoji}
              />
            ) : visible === 'stickers' ? (
              <StickerGrid
                packs={sheet.packs}
                state={sheet.panelState}
                recents={sheet.recents}
                activePackId={sheet.activePackId}
                onSelectPack={sheet.setActivePackId}
                onPick={sheet.pickSticker}
                onRetry={sheet.loadPanel}
              />
            ) : (
              <GifPanel open={sheet.sheetOpen} api={gifsApi} onPick={media.pickGif} />
            )}
          </View>
        </View>
      ) : null}
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
