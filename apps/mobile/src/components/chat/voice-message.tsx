import { formatDuration } from '@zilar/chat-core';
import type { VoiceMeta } from '@zilar/protocol';
import { Pause, Play } from 'lucide-react-native';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, View } from 'react-native';

import {
  subscribeVoicePlayError,
  subscribeVoiceProgress,
  subscribeVoiceState,
  type VoicePlayerControls,
} from './voice-player';
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
  voiceErrorCopy,
  type VoicePlayback,
  type VoiceSpeed,
} from '@/lib/voice-native';
import { useChatStore } from '@/store/chat-store-provider';
import type { UiMessage } from '@/lib/types';
import { useColorScheme } from 'nativewind';

const BAR_COUNT = 24;
const WAVEFORM_WIDTH = 108;

/**
 * Resolves the play source and applies it only when the request is still
 * the latest (finding 3, round 3): two taps with out-of-order resolves play
 * only the latest tap's source. Extracted so tests drive the race without
 * rendering; the bubble runs the same function from `toggle`.
 */
export async function resolvePlaySource(
  input: { voice: VoiceMeta; localUri?: string | undefined; trustedHosts: ReadonlySet<string> },
  seen: { current: number },
  request: number,
  onSource: (source: { uri: string; headers?: Record<string, string> }) => void,
  onMissing: () => void,
): Promise<void> {
  const source = await voiceAudioSource(input);
  if (seen.current !== request) {
    return;
  }
  if (source === undefined) {
    onMissing();
    return;
  }
  onSource(source);
}

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
  const [positionMs, setPositionMs] = useState(0);
  const [playError, setPlayError] = useState<string | undefined>(undefined);
  const [showTranscript, setShowTranscript] = useState(false);
  const bars = useMemo(() => sampleBars(voice.waveform, BAR_COUNT), [voice.waveform]);

  // The host owns play state, progress and play failures; the bubble only
  // mirrors its own subscription. Claiming only records UI state (finding
  // 1): the shared player is never paused as a side effect of switching.
  useEffect(() => {
    const stopState = subscribeVoiceState(message.id, (update) => {
      if (update.playing) {
        playback?.claim({
          messageId: message.id,
          playing: true,
          positionMs: 0,
          durationMs: voice.duration_ms,
          speed: update.rate,
          play: () => {},
          pause: () => {},
          seekTo: () => Promise.resolve(),
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
    });
    const stopProgress = subscribeVoiceProgress(message.id, (update) => {
      setPositionMs(update.positionMs);
    });
    const stopPlayError = subscribeVoicePlayError(message.id, (copy) => {
      setPlayError(copy);
      setPlaying(false);
    });
    return () => {
      stopState();
      stopProgress();
      stopPlayError();
    };
  }, [message.id, voice.duration_ms, playback]);

  const playable =
    failed || controls === undefined
      ? false
      : upload.localUri !== undefined && upload.localUri !== ''
        ? true
        : voice.url !== undefined && isPlayableVoiceUrl(voice.url, hosts);

  // Resolves the audio source lazily on play (the bearer must be fresh),
  // then hands it to the screen-owned player. `resolvePlaySource` carries
  // the request-id guard (finding 3): a stale resolve (an older tap whose
  // source arrives after a newer tap) is ignored, so the last tap wins.
  const playRequestRef = useRef(0);
  const toggle = () => {
    if (!playable || controls === undefined) {
      return;
    }
    if (playing) {
      controls.pause();
      setPlaying(false);
      return;
    }
    setPlayError(undefined);
    playRequestRef.current += 1;
    const request = playRequestRef.current;
    const atMs = positionMs;
    void resolvePlaySource(
      { voice, localUri: upload.localUri, trustedHosts: hosts },
      { current: playRequestRef.current },
      request,
      (source) => controls.play(message.id, source, atMs),
      () => setPlayError('Could not play that voice message.'),
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
  const fraction =
    voice.duration_ms <= 0 ? 0 : Math.min(1, Math.max(0, positionMs / voice.duration_ms));

  // Why the send failed, when the store recorded it (finding 4). The web
  // twin keeps the same fixed buckets; unknown errors stay generic.
  const failureCopy =
    message.failureReason === undefined ? "Couldn't send." : voiceErrorCopy(message.failureReason);

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
        {voice.transcript === undefined ? null : (
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
        )}
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
      {playError !== undefined && !uploading ? (
        <Text className="mt-1 px-0.5 text-[12px] text-danger">{playError}</Text>
      ) : null}
      {showTranscript && voice.transcript ? (
        <Text className="mt-1.5 text-[14px] leading-5 text-muted-foreground">
          {voice.transcript.text}
        </Text>
      ) : null}
    </View>
  );
}
