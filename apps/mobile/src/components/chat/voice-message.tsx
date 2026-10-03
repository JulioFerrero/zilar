import { formatDuration } from '@zilar/chat-core';
import type { VoiceMeta } from '@zilar/protocol';
import { Pause, Play } from 'lucide-react-native';
import { useEffect, useMemo, useState } from 'react';
import { Pressable, View } from 'react-native';

import { subscribeVoiceState, type VoicePlayerControls } from '@/components/chat/voice-player';
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
import { mobileUploadOf } from '@/lib/types';
import {
  isPlayableVoiceUrl,
  voiceAudioSource,
  type VoicePlayback,
  type VoiceSpeed,
} from '@/lib/voice-native';
import { useChatStore } from '@/store/chat-store-provider';
import type { UiMessage } from '@/lib/types';
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
  message: UiMessage;
  onRetryVoice?: ((message: UiMessage) => void) | undefined;
  onCancelVoice?: ((message: UiMessage) => void) | undefined;
  /** The shared one-at-a-time registry; tests inject a fake. */
  playback?: VoicePlayback | undefined;
  /** The screen-owned player for this bubble; tests inject a fake. */
  controls?: VoicePlayerControls | undefined;
};

/**
 * A voice bubble (T-0154): play/pause, a progress bar, elapsed/total time,
 * and a speed toggle. Playback comes from the local file while the upload
 * runs and from the served URL after (trusted hosts only — an untrusted
 * voice shows the waveform and the duration but never fetches). Only one
 * voice plays at a time through the shared registry.
 */
export function VoiceMessage({
  voice,
  outgoing,
  message,
  onRetryVoice,
  onCancelVoice,
  playback,
  controls,
}: VoiceMessageProps) {
  const scheme = asColorScheme(useColorScheme().colorScheme);
  const { pressed, reduceMotion, setPressed } = useKeyPress();
  const trustedHosts = useChatStore((state) => state.mediaTrustedHosts);
  const hosts = trustedHosts ?? new Set<string>();
  const upload = mobileUploadOf(message);
  const uploading = message.status === 'sending' && message.failed !== true;
  const failed = message.failed === true;
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState<VoiceSpeed>(1);
  const [showTranscript, setShowTranscript] = useState(false);
  const bars = useMemo(() => sampleBars(voice.waveform, BAR_COUNT), [voice.waveform]);

  useEffect(
    () =>
      subscribeVoiceState(message.id, (update) => {
        if (update.playing) {
          playback?.claim({
            messageId: message.id,
            playing: true,
            positionMs: 0,
            durationMs: voice.duration_ms,
            speed: update.rate,
            play: () => {},
            pause: () => {
              controls?.pause();
              setPlaying(false);
            },
            seekTo: (at) => {
              void controls?.seekTo(at).catch(() => {});
              return Promise.resolve();
            },
            cycleSpeed: () => {},
            release: () => {},
          });
        } else {
          playback?.resign({
            messageId: message.id,
            playing: false,
            positionMs: 0,
            durationMs: voice.duration_ms,
            speed: update.rate,
            play: () => {},
            pause: () => {},
            seekTo: () => Promise.resolve(),
            cycleSpeed: () => {},
            release: () => {},
          });
        }
        setPlaying(update.playing);
        setSpeed(update.rate);
      }),
    [message.id, voice.duration_ms, playback, controls],
  );

  const playable =
    failed || controls === undefined
      ? false
      : upload.localUri !== undefined && upload.localUri !== ''
        ? true
        : voice.url !== undefined && isPlayableVoiceUrl(voice.url, hosts);

  // Resolves the audio source lazily on play (the bearer must be fresh),
  // then hands it to the screen-owned player.
  const toggle = () => {
    if (!playable || controls === undefined) {
      return;
    }
    if (playing) {
      controls.pause();
      setPlaying(false);
      return;
    }
    void voiceAudioSource({ voice, localUri: upload.localUri, trustedHosts: hosts }).then(
      (source) => {
        if (source === undefined) {
          return;
        }
        controls.play(message.id, source);
      },
    );
  };

  const metaColor = outgoing
    ? BUBBLE_COLORS[scheme].outgoingMeta
    : BUBBLE_COLORS[scheme].incomingMeta;
  // Played/unplayed bars follow the bubble they sit in (white outgoing).
  const playedColor = outgoing ? '#0a0a0a' : '#ededed';
  const idleColor = outgoing ? '#a3a3a3' : '#525252';
  const durationColor = outgoing ? '#525252' : metaColor;
  const peak = Math.max(...bars, 1);
  // Live position comes from the host's 120 ms status ticks once playback
  // starts (see the device note in the Report); until then the bar is idle
  // and the label shows the total duration.
  const fraction = 0;
  const positionMs = 0;

  if (failed) {
    return (
      <View>
        <View className="flex-row items-center gap-2">
          <View className="h-9 w-9 items-center justify-center rounded-full" style={primaryKey}>
            <Play size={16} color={ACCENT_FOREGROUND} fill={ACCENT_FOREGROUND} />
          </View>
          <View className="flex-row items-center gap-[2px]" style={{ width: WAVEFORM_WIDTH }}>
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
          <Text className="text-[12px] text-danger">Couldn't send.</Text>
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

  return (
    <View className="py-0.5">
      <View className="flex-row items-center gap-2">
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={playing ? 'Pause voice message' : 'Play voice message'}
          disabled={!playable}
          onPress={toggle}
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
          onPress={toggle}
          className="flex-row items-center gap-[2px]"
          style={{ width: WAVEFORM_WIDTH }}
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
          onPress={() => controls?.cycleSpeed()}
          className="rounded-md px-1.5 py-0.5"
          style={iconKey}
        >
          <Text className="text-[11px] font-semibold" color={ICON_COLOR}>
            {speed}x
          </Text>
        </Pressable>
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
      {uploading ? (
        <View className="mt-1 flex-row items-center gap-2">
          <Text className="text-[12px] text-muted-foreground">
            {upload.uploadProgress === undefined
              ? 'Uploading…'
              : `Uploading… ${Math.round(upload.uploadProgress * 100)}%`}
          </Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Cancel voice upload"
            onPress={() => onCancelVoice?.(message)}
            className="rounded px-1 py-0.5 active:bg-surface-raised"
          >
            <Text className="text-[12px] text-muted-foreground">Cancel</Text>
          </Pressable>
        </View>
      ) : null}
      {showTranscript && voice.transcript ? (
        <Text className="mt-1.5 text-[14px] leading-5 text-muted-foreground">
          {voice.transcript.text}
        </Text>
      ) : null}
    </View>
  );
}
