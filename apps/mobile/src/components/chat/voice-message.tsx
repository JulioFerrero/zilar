import { formatDuration } from '@zilar/chat-core';
import type { VoiceMeta } from '@zilar/protocol';
import { Effect, Fiber } from 'effect';
import { AudioLines, Pause, Play } from 'lucide-react-native';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, View } from 'react-native';

import {
  subscribeVoicePlayError,
  subscribeVoiceProgress,
  subscribeVoiceState,
  type VoicePlayerControls,
} from './voice-player';
import { VoiceTranscribeConfirm } from './voice-transcribe-confirm';
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
import {
  readTranscripts,
  saveTranscript,
  type StoredTranscript,
  type TranscriptMap,
} from '@/lib/voice-transcripts';
import {
  consumeTranscribeConsent,
  transcribeVoiceNote,
  type TranscribePhase,
  type VoiceTranscribeSource,
} from '@/lib/voice-transcribe-flow';
import { createWhistlePort, type WhistlePort } from '@/lib/whistle-port';
import { useChatStore } from '@/store/chat-store-provider';
import type { UiMessage } from '@/lib/types';
import { useColorScheme } from 'nativewind';

const BAR_COUNT = 24;
// The bubble is at least this wide so the waveform can stretch to its end.
const VOICE_MIN_WIDTH = 236;

/**
 * Resolves the play source and applies it only when the request is still
 * the latest (finding 3, round 3): two taps with out-of-order resolves play
 * only the latest tap's source. Extracted so tests drive the race without
 * rendering; the bubble runs the same function from `toggle`.
 */
export function resolvePlaySourceEffect(
  input: { voice: VoiceMeta; localUri?: string | undefined; trustedHosts: ReadonlySet<string> },
  seen: { current: number },
  request: number,
  onSource: (source: { uri: string; headers?: Record<string, string> }) => void,
  onMissing: () => void,
): Effect.Effect<void, unknown> {
  return Effect.gen(function* () {
    const source = yield* Effect.tryPromise({
      try: () => voiceAudioSource(input),
      catch: (error) => error,
    });
    if (seen.current !== request) {
      return;
    }
    if (source === undefined) {
      onMissing();
      return;
    }
    onSource(source);
  });
}

export function resolvePlaySource(
  input: { voice: VoiceMeta; localUri?: string | undefined; trustedHosts: ReadonlySet<string> },
  seen: { current: number },
  request: number,
  onSource: (source: { uri: string; headers?: Record<string, string> }) => void,
  onMissing: () => void,
): Promise<void> {
  return Effect.runPromise(resolvePlaySourceEffect(input, seen, request, onSource, onMissing));
}

const resolved = (): Promise<void> => Effect.runPromise(Effect.void);

const isPromiseLike = (value: unknown): value is PromiseLike<void> =>
  typeof value === 'object' && value !== null && 'then' in value;

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
  // The on-device transcript, kept locally (never on the wire): the stored
  // value wins, then the freshly transcribed text of this session.
  const [storedTranscripts, setStoredTranscripts] = useState<TranscriptMap | undefined>(
    () => transcripts,
  );
  const [localText, setLocalText] = useState<StoredTranscript | undefined>(undefined);
  const [transcribeBusy, setTranscribeBusy] = useState(false);
  const [transcribePhase, setTranscribePhase] = useState<TranscribePhase | undefined>(undefined);
  const [transcribeError, setTranscribeError] = useState<string | undefined>(undefined);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const whistlePort = useMemo(() => whistle ?? createWhistlePort(), [whistle]);
  const transcribeRun = useRef(0);
  // The one-shot model-download consent (T-0179, round 1): set only by the
  // sheet's Download button for this run, consumed by `confirmDownload`.
  const transcribeConsent = useRef({ confirmed: false });
  const bars = useMemo(() => sampleBars(voice.waveform, BAR_COUNT), [voice.waveform]);

  // A stored transcript is shown at once on the next app start: read it
  // here when the caller did not inject one (no re-run).
  useEffect(() => {
    if (transcripts !== undefined) {
      return;
    }
    const reading = Effect.runFork(
      Effect.tryPromise(() => readTranscripts()).pipe(
        Effect.flatMap((all) => Effect.sync(() => setStoredTranscripts(all))),
        Effect.ignore,
      ),
    );
    return () => {
      Effect.runFork(Fiber.interrupt(reading));
    };
  }, [transcripts, message.id]);

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

  const storedText = storedTranscripts?.[message.id];
  const transcriptText = storedText ?? localText;
  const hasTranscript = transcriptText !== undefined || voice.transcript !== undefined;
  const shownText = transcriptText?.text ?? voice.transcript?.text;

  // The Transcribe button shows only on phones with the engine, only when
  // no transcript exists yet, and only when the audio is playable. Probing
  // the engine is synchronous and safe (it only reads the ABI list).
  const whistleAvailable = Effect.runSync(
    Effect.try(() => whistlePort.isAvailable()).pipe(Effect.orElseSucceed(() => false)),
  );
  const showTranscribe = whistleAvailable && !hasTranscript && playable;

  const runTranscribe = () => {
    transcribeRun.current += 1;
    const run = transcribeRun.current;
    setTranscribeBusy(true);
    setTranscribeError(undefined);
    setTranscribePhase(undefined);
    // The model download needs the user's yes (round 1): the sheet's
    // Download sets `transcribeConsent` for this run, and the gate
    // consumes it — no yes, no download, the sheet re-opens instead.
    const consent = transcribeConsent.current;
    const askDownload = (): boolean => {
      if (transcribeRun.current !== run) {
        return false;
      }
      const ok = consumeTranscribeConsent(consent, () => {
        if (transcribeRun.current === run) {
          setConfirmOpen(true);
        }
      });
      if (!ok && transcribeRun.current === run) {
        setTranscribeBusy(false);
        setTranscribePhase(undefined);
      }
      return ok;
    };
    const program = Effect.gen(function* () {
      const source = yield* Effect.tryPromise(() =>
        voiceAudioSource({ voice, localUri: upload.localUri, trustedHosts: hosts }),
      );
      if (transcribeRun.current !== run) {
        return;
      }
      if (source === undefined) {
        setTranscribeBusy(false);
        setTranscribeError('Could not read that voice message.');
        return;
      }
      // A local file transcribes in place; a served URL downloads to the
      // cache with its headers (the flow always deletes the cached file).
      const audioSource: VoiceTranscribeSource =
        upload.localUri !== undefined && upload.localUri !== ''
          ? { localUri: upload.localUri }
          : { url: source.uri, headers: source.headers };
      const result = yield* Effect.tryPromise(() =>
        transcribeVoiceNote({
          port: whistlePort,
          source: audioSource,
          audioMs: voice.duration_ms,
          onPhase: (phase) => {
            if (transcribeRun.current === run) {
              setTranscribePhase(phase);
            }
          },
          confirmDownload: () => Effect.runPromise(Effect.sync(askDownload)),
        }),
      );
      if (transcribeRun.current !== run) {
        return;
      }
      setTranscribeBusy(false);
      setTranscribePhase(undefined);
      if (result.status === 'cancelled') {
        return;
      }
      if (result.status === 'error') {
        setTranscribeError(result.message);
        return;
      }
      const text = result.transcript.text.trim();
      const entry: StoredTranscript =
        result.transcript.language === ''
          ? { text }
          : { text, language: result.transcript.language };
      setLocalText(entry);
      setShowTranscript(true);
      setStoredTranscripts((current) => ({ ...current, [message.id]: entry }));
      // The text is already on screen; a blocked store keeps it local.
      yield* Effect.try(
        () => onSaveTranscript?.(message.id, entry) ?? saveTranscript(message.id, entry),
      ).pipe(
        Effect.flatMap((pending) =>
          isPromiseLike(pending) ? Effect.tryPromise(() => pending) : Effect.void,
        ),
        Effect.ignore,
      );
    });
    Effect.runFork(
      program.pipe(
        Effect.catchCause(() =>
          Effect.sync(() => {
            if (transcribeRun.current === run) {
              setTranscribeBusy(false);
              setTranscribePhase(undefined);
              setTranscribeError('Could not transcribe that voice note. Try again.');
            }
          }),
        ),
      ),
    );
  };

  const startTranscribe = () => {
    if (!showTranscribe || transcribeBusy) {
      return;
    }
    // The user's yes must be fresh (round 1): a previous confirm never
    // carries over — the model check decides whether the sheet opens.
    transcribeConsent.current.confirmed = false;
    Effect.runFork(
      Effect.tryPromise(() => whistlePort.modelStatus()).pipe(
        Effect.flatMap((status) =>
          Effect.try(() => {
            if (status === 'ready') {
              runTranscribe();
            } else {
              setConfirmOpen(true);
            }
          }),
        ),
        Effect.catch(() => Effect.sync(runTranscribe)),
      ),
    );
  };

  const confirmTranscribe = () => {
    setConfirmOpen(false);
    transcribeConsent.current.confirmed = true;
    runTranscribe();
  };

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

  return (
    <View className="py-0.5" style={{ minWidth: VOICE_MIN_WIDTH }}>
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
            // A fresh view per look: RN 0.86 on Android crashes in draw when a live
            // view swaps one gradient style for another (device report 2026-10-04).
            key={showTranscript ? 'transcript-on' : 'transcript-off'}
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
        {transcriptText === undefined && voice.transcript === undefined && showTranscribe ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Transcribe voice message"
            disabled={transcribeBusy}
            onPress={startTranscribe}
            className="rounded-md px-1.5 py-0.5 disabled:opacity-60"
            style={iconKey}
          >
            <AudioLines size={14} color={ICON_COLOR} />
          </Pressable>
        ) : null}
        {transcriptText !== undefined && voice.transcript === undefined ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={showTranscript ? 'Hide transcript' : 'Show transcript'}
            onPress={() => setShowTranscript((value) => !value)}
            className="rounded-md px-1.5 py-0.5"
            key={showTranscript ? 'transcript-on' : 'transcript-off'}
            style={showTranscript ? segment : iconKey}
          >
            <Text
              className="text-[11px] font-semibold"
              color={showTranscript ? undefined : ICON_COLOR}
            >
              Aa
            </Text>
          </Pressable>
        ) : null}
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
        onClose={() => setConfirmOpen(false)}
      />
    </View>
  );
}
