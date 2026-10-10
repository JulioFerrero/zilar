import type { VoiceMeta } from '@zilar/protocol';
import { Effect } from 'effect';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, View } from 'react-native';

import { VoiceMessageBars, VoiceMessageFailedBars } from './voice-message-bars';
import {
  BAR_COUNT,
  resolvePlaySourceEffect,
  resolved,
  sampleBars,
  VOICE_MIN_WIDTH,
} from './voice-playback-source';
import {
  subscribeVoicePlayError,
  subscribeVoiceProgress,
  subscribeVoiceState,
  type VoicePlayerControls,
} from './voice-player';
import { VoiceTranscribeConfirm } from './voice-transcribe-confirm';
import { useVoiceTranscribe } from './use-voice-transcribe';
import { Text } from '@/components/ui/text';
import { useKeyPress } from '@/components/ui/use-key-press';
import { mobileUploadOf, type UiMessage } from '@/lib/types';
import { isPlayableVoiceUrl, type VoicePlayback, type VoiceSpeed } from '@/lib/voice-native';
import { type StoredTranscript, type TranscriptMap } from '@/lib/voice-transcripts';
import type { WhistlePort } from '@/lib/whistle-port';
import { useChatStore } from '@/store/chat-store-provider';

export { resolvePlaySource, resolvePlaySourceEffect } from './voice-playback-source';

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
  /** The on-device transcription engine; tests inject a fake. */
  whistle?: WhistlePort | undefined;
  /** Stored transcripts; tests inject a fake map. */
  transcripts?: TranscriptMap | undefined;
  /** Persists one transcript; tests inject a fake. */
  onSaveTranscript?: ((id: string, entry: StoredTranscript) => Promise<void> | void) | undefined;
};

/**
 * A voice bubble (T-0154, on-device transcription T-0179): play/pause, a
 * progress bar, elapsed/total time, and a speed toggle. Playback comes from
 * the local file while the upload runs and from the served URL after
 * (trusted hosts only — an untrusted voice shows the waveform and the
 * duration but never fetches). Only one voice plays at a time through the
 * shared registry. On phones with the Whistle engine a Transcribe button
 * runs the on-device model and keeps the text on the phone only.
 */
export function VoiceMessage({
  voice,
  outgoing,
  message,
  onRetryVoice,
  onCancelVoice,
  playback,
  controls,
  whistle,
  transcripts,
  onSaveTranscript,
}: VoiceMessageProps) {
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
          seekTo: resolved,
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
          seekTo: resolved,
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

  const {
    showTranscript,
    toggleTranscript,
    shownText,
    localTranscript,
    showTranscribe,
    transcribeBusy,
    transcribePhase,
    transcribeError,
    confirmOpen,
    startTranscribe,
    confirmTranscribe,
    closeConfirm,
  } = useVoiceTranscribe({
    voice,
    messageId: message.id,
    localUri: upload.localUri,
    trustedHosts: hosts,
    playable,
    transcripts,
    whistle,
    onSaveTranscript,
  });

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
    Effect.runFork(
      resolvePlaySourceEffect(
        { voice, localUri: upload.localUri, trustedHosts: hosts },
        { current: playRequestRef.current },
        request,
        (source) => controls.play(message.id, source, atMs),
        () => setPlayError('Could not play that voice message.'),
      ),
    );
  };

  const fraction =
    voice.duration_ms <= 0 ? 0 : Math.min(1, Math.max(0, positionMs / voice.duration_ms));

  if (failed) {
    return (
      <VoiceMessageFailedBars
        voice={voice}
        bars={bars}
        outgoing={outgoing}
        message={message}
        onRetryVoice={onRetryVoice}
      />
    );
  }

  return (
    <View className="py-0.5" style={{ minWidth: VOICE_MIN_WIDTH }}>
      <VoiceMessageBars
        voice={voice}
        bars={bars}
        fraction={fraction}
        outgoing={outgoing}
        playing={playing}
        playable={playable}
        pressed={pressed}
        reduceMotion={reduceMotion}
        setPressed={setPressed}
        onToggle={toggle}
        positionMs={positionMs}
        speed={speed}
        onCycleSpeed={() => controls?.cycleSpeed()}
        showTranscript={showTranscript}
        onToggleTranscript={toggleTranscript}
        hasLocalTranscript={localTranscript}
        showTranscribe={showTranscribe}
        transcribeBusy={transcribeBusy}
        onTranscribe={startTranscribe}
      />
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
      {transcribeBusy || transcribePhase !== undefined ? (
        <Text className="mt-1 px-0.5 text-[12px] text-muted-foreground">
          {transcribePhase?.kind === 'downloading'
            ? `Downloading the model… ${Math.round(transcribePhase.fraction * 100)}%`
            : transcribePhase?.kind === 'loading'
              ? 'Loading the model…'
              : 'Transcribing…'}
        </Text>
      ) : null}
      {transcribeError !== undefined && !transcribeBusy ? (
        <View className="mt-1 flex-row items-center gap-2 px-0.5">
          <Text className="text-[12px] text-danger">{transcribeError}</Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Retry transcription"
            onPress={startTranscribe}
            className="rounded px-1 py-0.5 active:bg-surface-raised"
          >
            <Text className="text-[12px] font-semibold text-danger">Retry</Text>
          </Pressable>
        </View>
      ) : null}
      {showTranscript && shownText !== undefined ? (
        <Text className="mt-1.5 text-[14px] leading-5 text-muted-foreground">{shownText}</Text>
      ) : null}
      <VoiceTranscribeConfirm
        open={confirmOpen}
        busy={transcribeBusy}
        onDownload={confirmTranscribe}
        onClose={closeConfirm}
      />
    </View>
  );
}
