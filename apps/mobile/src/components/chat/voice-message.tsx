import { formatDuration } from '@galena/chat-core';
import type { VoiceMeta } from '@galena/protocol';
import { Pause, Play } from 'lucide-react-native';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, View } from 'react-native';

import { Text } from '@/components/ui/text';
import { useKeyPress } from '@/components/ui/use-key-press';
import { asColorScheme } from '@/lib/color-scheme';
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
import { useColorScheme } from 'nativewind';

const BAR_COUNT = 24;
const WAVEFORM_WIDTH = 108;

function sampleBars(waveform: readonly number[], count: number): number[] {
  if (waveform.length <= count) {
    return [...waveform];
  }
  return Array.from({ length: count }, (_, index) => {
    const position = (index / count) * waveform.length;
    return waveform[Math.floor(position)] ?? 0;
  });
}

type VoiceMessageProps = {
  voice: VoiceMeta;
  outgoing: boolean;
};

/** Play/pause toggle, waveform, duration and transcript. No real audio yet. */
export function VoiceMessage({ voice, outgoing }: VoiceMessageProps) {
  const scheme = asColorScheme(useColorScheme().colorScheme);
  const { pressed, reduceMotion, setPressed } = useKeyPress();
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [showTranscript, setShowTranscript] = useState(false);
  const progressRef = useRef(0);
  const bars = useMemo(() => sampleBars(voice.waveform, BAR_COUNT), [voice.waveform]);

  useEffect(() => {
    if (!playing) {
      return;
    }
    const step = 120 / voice.duration_ms;
    const timer = setInterval(() => {
      const next = progressRef.current + step;
      if (next >= 1) {
        progressRef.current = 0;
        setProgress(0);
        setPlaying(false);
        return;
      }
      progressRef.current = next;
      setProgress(next);
    }, 120);
    return () => clearInterval(timer);
  }, [playing, voice.duration_ms]);

  const metaColor = outgoing
    ? BUBBLE_COLORS[scheme].outgoingMeta
    : BUBBLE_COLORS[scheme].incomingMeta;
  // Played/unplayed bars follow the bubble they sit in (white outgoing).
  const playedColor = outgoing ? '#0a0a0a' : '#ededed';
  const idleColor = outgoing ? '#a3a3a3' : '#525252';
  const durationColor = outgoing ? '#525252' : metaColor;
  const peak = Math.max(...bars, 1);

  return (
    <View className="py-0.5">
      <View className="flex-row items-center gap-2">
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={playing ? 'Pause voice message' : 'Play voice message'}
          onPress={() => setPlaying((value) => !value)}
          onPressIn={() => setPressed(true)}
          onPressOut={() => setPressed(false)}
          className="h-9 w-9 items-center justify-center rounded-full"
          style={[primaryKey, pressStyle(pressed, KEY_PRIMARY_PRESSED_SHADOW, reduceMotion)]}
        >
          {playing ? (
            <Pause size={16} color={ACCENT_FOREGROUND} fill={ACCENT_FOREGROUND} />
          ) : (
            <Play size={16} color={ACCENT_FOREGROUND} fill={ACCENT_FOREGROUND} />
          )}
        </Pressable>
        <View className="flex-row items-center gap-[2px]" style={{ width: WAVEFORM_WIDTH }}>
          {bars.map((value, index) => {
            const played = index / bars.length <= progress;
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
        </View>
        <Text className="font-mono text-[12px]" color={durationColor}>
          {formatDuration(voice.duration_ms)}
        </Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={showTranscript ? 'Hide transcript' : 'Show transcript'}
          onPress={() => setShowTranscript((value) => !value)}
          className="rounded-md px-1.5 py-0.5"
          style={showTranscript ? segment : iconKey}
        >
          <Text
            className="text-[11px] font-semibold"
            color={showTranscript ? undefined : ICON_COLOR}
          >
            Aa
          </Text>
        </Pressable>
      </View>
      {showTranscript && voice.transcript ? (
        <Text className="mt-1.5 text-[14px] leading-5 text-muted-foreground">
          {voice.transcript.text}
        </Text>
      ) : null}
    </View>
  );
}
