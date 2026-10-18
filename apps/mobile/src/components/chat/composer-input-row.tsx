import { lightToPlain } from '@zilar/chat-core';
import { ArrowUp, Check, Keyboard, Paperclip, Smile, X } from 'lucide-react-native';
import type { RefObject } from 'react';
import { Pressable, TextInput, View } from 'react-native';

import { tap } from '@/components/chat/haptics';
import { useBackCancel } from '@/components/chat/use-back-cancel';
import { VoiceRecorderButton } from '@/components/chat/voice-recorder';
import { IconButton } from '@/components/ui/icon-button';
import { Text } from '@/components/ui/text';
import { useKeyPress } from '@/components/ui/use-key-press';
import { ICON } from '@/lib/colors';
import {
  ACCENT_FOREGROUND,
  KEY_PRIMARY_PRESSED_SHADOW,
  pressStyle,
  primaryKey,
  well,
} from '@/lib/depth';
import type { CaretSelection } from '@/lib/emoji-data';
import type { ReplyRef } from '@/lib/types';
import type { SendTextOptions, SendVoiceRecording } from '@/store/types';

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

type ComposerInputRowProps = {
  placeholder: string;
  text: string;
  onChangeText: (value: string) => void;
  selection: CaretSelection | undefined;
  onSelectionChange: (selection: CaretSelection) => void;
  inputHeight: number;
  onInputHeightChange: (height: number) => void;
  canSend: boolean;
  editing: boolean;
  stagedCount: number;
  onSend: () => void;
  onOpenAttach: () => void;
  onOpenSheet: () => void;
  sheetOpen: boolean;
  onCloseSheet: () => void;
  voiceRecording: boolean;
  onRecordingChange: (recording: boolean) => void;
  replyTo: ReplyRef | undefined;
  onCancelReply: () => void;
  onSendVoice: ((recording: SendVoiceRecording, options?: SendTextOptions) => void) | undefined;
  inputRef?: RefObject<TextInput | null> | undefined;
};

export function ComposerInputRow({
  placeholder,
  text,
  onChangeText,
  selection,
  onSelectionChange,
  inputHeight,
  onInputHeightChange,
  canSend,
  editing,
  stagedCount,
  onSend,
  onOpenAttach,
  onOpenSheet,
  sheetOpen,
  onCloseSheet,
  voiceRecording,
  onRecordingChange,
  replyTo,
  onCancelReply,
  onSendVoice,
  inputRef,
}: ComposerInputRowProps) {
  const { pressed, reduceMotion, setPressed } = useKeyPress();
  const iconColor = ICON;
  const sendLabel = editing
    ? 'Save edit'
    : stagedCount >= 2
      ? `Send ${stagedCount} files`
      : 'Send message';
  const showKeyboard = () => {
    onCloseSheet();
    inputRef?.current?.focus();
  };
  return (
    <View
      className="flex-row items-end gap-1 rounded-[14px] p-2"
      style={[well, { borderColor: '#262626' }]}
    >
      {!voiceRecording ? (
        <>
          <IconButton label="Attach file" className="h-9 w-9 rounded-[10px]" onPress={onOpenAttach}>
            <Paperclip size={20} color={iconColor} />
          </IconButton>
          <TextInput
            ref={inputRef}
            value={text}
            onChangeText={onChangeText}
            multiline
            placeholder={placeholder}
            placeholderTextColor="#a1a1a1"
            accessibilityLabel="Message"
            className="mx-1 flex-1 py-2 text-[16px] text-foreground"
            style={{ height: inputHeight, maxHeight: MAX_INPUT_HEIGHT, lineHeight: 20 }}
            selection={selection}
            onFocus={() => {
              if (sheetOpen) {
                onCloseSheet();
              }
            }}
            onContentSizeChange={(event) =>
              onInputHeightChange(fieldHeightFor(event.nativeEvent.contentSize.height))
            }
            onSelectionChange={(event) =>
              onSelectionChange({
                start: event.nativeEvent.selection.start,
                end: event.nativeEvent.selection.end,
              })
            }
          />
          <IconButton
            label={sheetOpen ? 'Keyboard' : 'Emoji'}
            className="h-9 w-9 rounded-[10px]"
            onPress={sheetOpen ? showKeyboard : onOpenSheet}
          >
            {sheetOpen ? (
              <Keyboard size={20} color={iconColor} />
            ) : (
              <Smile size={20} color={iconColor} />
            )}
          </IconButton>
        </>
      ) : null}
      {canSend ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={sendLabel}
          hitSlop={8}
          onPress={() => {
            tap();
            onSend();
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
          canSend={canSend}
          onRecordingChange={onRecordingChange}
        />
      )}
    </View>
  );
}
