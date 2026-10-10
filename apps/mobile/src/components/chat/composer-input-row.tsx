import { ArrowUp, Paperclip, Smile, X } from 'lucide-react-native';
import { Pressable, TextInput, View } from 'react-native';

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

export function ReplyBar({ reply, onCancel }: { reply: ReplyRef; onCancel: () => void }) {
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
  onSend: () => void;
  onOpenAttach: () => void;
  onOpenSheet: () => void;
  voiceRecording: boolean;
  onRecordingChange: (recording: boolean) => void;
  replyTo: ReplyRef | undefined;
  onCancelReply: () => void;
  onSendVoice: ((recording: SendVoiceRecording, options?: SendTextOptions) => void) | undefined;
};

/** The composer's input row: attach, auto-growing input, emoji and mic/send. */
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
  onSend,
  onOpenAttach,
  onOpenSheet,
  voiceRecording,
  onRecordingChange,
  replyTo,
  onCancelReply,
  onSendVoice,
}: ComposerInputRowProps) {
  const { pressed, reduceMotion, setPressed } = useKeyPress();
  const iconColor = ICON;
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
            value={text}
            onChangeText={onChangeText}
            multiline
            placeholder={placeholder}
            placeholderTextColor="#a1a1a1"
            accessibilityLabel="Message"
            className="mx-1 flex-1 py-2 text-[16px] text-foreground"
            style={{ height: inputHeight, maxHeight: MAX_INPUT_HEIGHT, lineHeight: 20 }}
            selection={selection}
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
          <IconButton label="Emoji" className="h-9 w-9 rounded-[10px]" onPress={onOpenSheet}>
            <Smile size={20} color={iconColor} />
          </IconButton>
        </>
      ) : null}
      {canSend ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={editing ? 'Save edit' : 'Send message'}
          onPress={onSend}
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
          onRecordingChange={onRecordingChange}
        />
      )}
    </View>
  );
}
