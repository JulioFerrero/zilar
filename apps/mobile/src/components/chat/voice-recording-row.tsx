import { ArrowUp, ChevronLeft, Trash2 } from 'lucide-react-native';
import { Pressable, View } from 'react-native';

import { Text } from '@/components/ui/text';
import { useKeyPress } from '@/components/ui/use-key-press';
import { ICON } from '@/lib/colors';
import { ACCENT_FOREGROUND, KEY_PRIMARY_PRESSED_SHADOW, pressStyle, primaryKey } from '@/lib/depth';

import { formatElapsed } from '@/components/chat/voice-recorder-flow';

type VoiceRecordingRowProps = {
  elapsedMs: number;
  willCancel: boolean;
  locked: boolean;
  onCancel: () => void;
  onSend: () => void;
};

/** The red dot and the running timer, shared by both row variants. */
function RecordingMeta({ elapsedMs }: { elapsedMs: number }) {
  return (
    <>
      <View className="size-2.5 shrink-0 rounded-full bg-danger" />
      <Text className="shrink-0 font-mono text-[15px] tabular-nums text-foreground">
        {formatElapsed(elapsedMs)}
      </Text>
    </>
  );
}

/**
 * The row that replaces the composer input while recording. With the finger
 * still down (T-1202) it shows the slide-to-cancel hint; once the recording is
 * locked (T-1280) the finger has lifted, so it swaps to a Cancel (trash) key
 * and a Send key modeled on the composer's send button.
 */
export function VoiceRecordingRow({
  elapsedMs,
  willCancel,
  locked,
  onCancel,
  onSend,
}: VoiceRecordingRowProps) {
  const { pressed, reduceMotion, setPressed } = useKeyPress();
  return (
    <View className="h-9 min-w-0 flex-1 flex-row items-center gap-3 px-1">
      <RecordingMeta elapsedMs={elapsedMs} />
      {locked ? (
        <>
          <View className="flex-1" />
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Cancel recording"
            hitSlop={8}
            onPress={onCancel}
            className="h-9 w-9 items-center justify-center rounded-[10px]"
          >
            <Trash2 size={18} color={ICON} />
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Send voice message"
            onPress={onSend}
            onPressIn={() => setPressed(true)}
            onPressOut={() => setPressed(false)}
            className="h-9 w-9 items-center justify-center rounded-[10px]"
            style={[primaryKey, pressStyle(pressed, KEY_PRIMARY_PRESSED_SHADOW, reduceMotion)]}
          >
            <ArrowUp size={20} color={ACCENT_FOREGROUND} />
          </Pressable>
        </>
      ) : willCancel ? (
        <Text numberOfLines={1} className="min-w-0 flex-1 text-center text-[13px] text-danger">
          Release to cancel
        </Text>
      ) : (
        <View className="min-w-0 flex-1 flex-row items-center justify-center gap-1">
          <ChevronLeft size={14} color={ICON} />
          <Text numberOfLines={1} className="text-[13px] text-muted-foreground">
            Slide to cancel
          </Text>
        </View>
      )}
      {!locked ? <Trash2 size={18} color={willCancel ? '#f87171' : ICON} /> : null}
    </View>
  );
}
