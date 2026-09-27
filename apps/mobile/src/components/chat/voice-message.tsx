import type { VoiceMeta } from '@galena/protocol';
import { Pause, Play } from 'lucide-react-native';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, View } from 'react-native';

import { Text } from '@/components/ui/text';
import { asColorScheme } from '@/lib/color-scheme';
import { ACCENT, BUBBLE_COLORS, MUTED_FOREGROUND } from '@/lib/colors';
import { formatVoiceDuration } from '@/lib/time';
import { cn } from '@/lib/utils';
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
  const idleBar = outgoing ? BUBBLE_COLORS[scheme].outgoingMeta : MUTED_FOREGROUND[scheme];
  const peak = Math.max(...bars, 1);

  return (
    <View className="py-0.5">
      <View className="flex-row items-center gap-2">
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={playing ? 'Pause voice message' : 'Play voice message'}
          onPress={() => setPlaying((value) => !value)}
          className="h-9 w-9 items-center justify-center rounded-full bg-accent"
        >
          {playing ? (
            <Pause size={16} color="#ffffff" fill="#ffffff" />
          ) : (
            <Play size={16} color="#ffffff" fill="#ffffff" />
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
                  backgroundColor: played ? ACCENT[scheme] : idleBar,
                }}
              />
            );
          })}
        </View>
        <Text className="text-[13px]" style={{ color: metaColor }}>
          {formatVoiceDuration(voice.duration_ms)}
        </Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={showTranscript ? 'Hide transcript' : 'Show transcript'}
          onPress={() => setShowTranscript((value) => !value)}
          className={cn(
            'h-7 w-7 items-center justify-center rounded-full',
            showTranscript ? 'bg-accent' : 'bg-black/10',
          )}
        >
          <Text
            className={cn(
              'text-[13px] font-semibold',
              showTranscript ? 'text-white' : 'text-foreground',
            )}
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
