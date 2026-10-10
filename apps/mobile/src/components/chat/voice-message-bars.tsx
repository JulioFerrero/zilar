import { formatDuration } from '@zilar/chat-core';
import type { VoiceMeta } from '@zilar/protocol';
import { AudioLines, Pause, Play } from 'lucide-react-native';
import { Pressable, View } from 'react-native';

import { VOICE_MIN_WIDTH } from './voice-playback-source';
import { Text } from '@/components/ui/text';
import { BUBBLE_COLORS } from '@/lib/colors';
import {
  ACCENT_FOREGROUND,
  ICON_COLOR,
  KEY_PRIMARY_PRESSED_SHADOW,
  iconKey,
  pressStyle,
  primaryKey,
  segment,
} from '@/lib/depth';
import type { UiMessage } from '@/lib/types';
import { type VoiceSpeed, voiceErrorCopy } from '@/lib/voice-native';

/**
 * The one "Aa" control both transcript toggles used to repeat (dedup). Callers
 * key it by the look so Android builds a fresh view instead of swapping one
 * gradient style for another on a live view (device report 2026-10-04).
 */
export function TranscriptToggle({ show, onToggle }: { show: boolean; onToggle: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={show ? 'Hide transcript' : 'Show transcript'}
      onPress={onToggle}
      className="rounded-md px-1.5 py-0.5"
      style={show ? segment : iconKey}
    >
      <Text className="text-[11px] font-semibold" color={show ? undefined : ICON_COLOR}>
        Aa
      </Text>
    </Pressable>
  );
}

/** The bubble body once the send failed: waveform, duration and Retry. */
export function VoiceMessageFailedBars({
  voice,
  bars,
  outgoing,
  message,
  onRetryVoice,
}: {
  voice: VoiceMeta;
  bars: number[];
  outgoing: boolean;
  message: UiMessage;
  onRetryVoice?: ((message: UiMessage) => void) | undefined;
}) {
  const idleColor = outgoing ? '#a3a3a3' : '#525252';
  const durationColor = outgoing ? '#525252' : BUBBLE_COLORS.incomingMeta;
  const peak = Math.max(...bars, 1);
  // Why the send failed, when the store recorded it (finding 4). The web
  // twin keeps the same fixed buckets; unknown errors stay generic.
  const failureCopy =
    message.failureReason === undefined ? "Couldn't send." : voiceErrorCopy(message.failureReason);
  return (
    <View style={{ minWidth: VOICE_MIN_WIDTH }}>
      <View className="flex-row items-center gap-2">
        <View className="h-9 w-9 items-center justify-center rounded-full" style={primaryKey}>
          <Play size={16} color={ACCENT_FOREGROUND} fill={ACCENT_FOREGROUND} />
        </View>
        <View className="flex-1 flex-row items-center justify-between">
          {bars.map((value, index) => (
            <View
              key={index}
              className="rounded-full"
              style={{
                width: 2.5,
                height: 4 + (value / peak) * 16,
                backgroundColor: idleColor,
              }}
            />
          ))}
        </View>
        <Text className="font-mono text-[12px]" color={durationColor}>
          {formatDuration(voice.duration_ms)}
        </Text>
      </View>
      <View className="mt-1 flex-row items-center gap-2">
        <Text className="text-[12px] text-danger">{failureCopy}</Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Retry sending voice message"
          onPress={() => onRetryVoice?.(message)}
          className="rounded px-1 py-0.5 active:bg-surface-raised"
        >
          <Text className="text-[12px] font-semibold text-danger">Retry</Text>
        </Pressable>
      </View>
    </View>
  );
}

/** The play/pause transport row: waveform, elapsed time, speed and toggles. */
export function VoiceMessageBars({
  voice,
  bars,
  fraction,
  outgoing,
  playing,
  playable,
  pressed,
  reduceMotion,
  setPressed,
  onToggle,
  positionMs,
  speed,
  onCycleSpeed,
  showTranscript,
  onToggleTranscript,
  hasLocalTranscript,
  showTranscribe,
  transcribeBusy,
  onTranscribe,
}: {
  voice: VoiceMeta;
  bars: number[];
  fraction: number;
  outgoing: boolean;
  playing: boolean;
  playable: boolean;
  pressed: boolean;
  reduceMotion: boolean;
  setPressed: (pressed: boolean) => void;
  onToggle: () => void;
  positionMs: number;
  speed: VoiceSpeed;
  onCycleSpeed: () => void;
  showTranscript: boolean;
  onToggleTranscript: () => void;
  hasLocalTranscript: boolean;
  showTranscribe: boolean;
  transcribeBusy: boolean;
  onTranscribe: () => void;
}) {
  // Played/unplayed bars follow the bubble they sit in (white outgoing).
  const playedColor = outgoing ? '#0a0a0a' : '#ededed';
  const idleColor = outgoing ? '#a3a3a3' : '#525252';
  const durationColor = outgoing ? '#525252' : BUBBLE_COLORS.incomingMeta;
  const peak = Math.max(...bars, 1);
  return (
    <View className="flex-row items-center gap-2">
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={playing ? 'Pause voice message' : 'Play voice message'}
        disabled={!playable}
        onPress={onToggle}
        onPressIn={() => setPressed(true)}
        onPressOut={() => setPressed(false)}
        className="h-9 w-9 items-center justify-center rounded-full disabled:opacity-60"
        style={[primaryKey, pressStyle(pressed, KEY_PRIMARY_PRESSED_SHADOW, reduceMotion)]}
      >
        {playing ? (
          <Pause size={16} color={ACCENT_FOREGROUND} fill={ACCENT_FOREGROUND} />
        ) : (
          <Play size={16} color={ACCENT_FOREGROUND} fill={ACCENT_FOREGROUND} />
        )}
      </Pressable>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={playing ? 'Pause voice message' : 'Play voice message'}
        disabled={!playable}
        onPress={onToggle}
        className="flex-1 flex-row items-center justify-between"
      >
        {bars.map((value, index) => {
          const played = index / bars.length <= fraction;
          return (
            <View
              key={index}
              className="rounded-full"
              style={{
                width: 2.5,
                height: 4 + (value / peak) * 16,
                backgroundColor: played ? playedColor : idleColor,
              }}
            />
          );
        })}
      </Pressable>
      <Text className="font-mono text-[12px]" color={durationColor}>
        {formatDuration(positionMs > 0 ? positionMs : voice.duration_ms)}
      </Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Playback speed ${speed}x`}
        onPress={onCycleSpeed}
        className="rounded-md px-1.5 py-0.5"
        style={iconKey}
      >
        <Text className="text-[11px] font-semibold" color={ICON_COLOR}>
          {speed}x
        </Text>
      </Pressable>
      {voice.transcript === undefined ? null : (
        <TranscriptToggle
          key={showTranscript ? 'transcript-on' : 'transcript-off'}
          show={showTranscript}
          onToggle={onToggleTranscript}
        />
      )}
      {showTranscribe ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Transcribe voice message"
          disabled={transcribeBusy}
          onPress={onTranscribe}
          className="rounded-md px-1.5 py-0.5 disabled:opacity-60"
          style={iconKey}
        >
          <AudioLines size={14} color={ICON_COLOR} />
        </Pressable>
      ) : null}
      {hasLocalTranscript && voice.transcript === undefined ? (
        <TranscriptToggle
          key={showTranscript ? 'transcript-on' : 'transcript-off'}
          show={showTranscript}
          onToggle={onToggleTranscript}
        />
      ) : null}
    </View>
  );
}
