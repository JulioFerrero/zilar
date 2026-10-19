import type { VoiceMeta } from '@zilar/protocol';
import { isLoadableMediaUrl } from '@zilar/chat-core';
import { Effect } from 'effect';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, View } from 'react-native';
import { VoiceMessageBars, VoiceMessageFailedBars } from './voice-message-bars';
import {
  BAR_COUNT,
  isPromiseLike,
  resolvePlaySourceEffect,
  resolved,
  sampleBars,
  VOICE_MIN_WIDTH,
} from './voice-playback-source';
import {
  subscribeVoicePlayError,
  subscribeVoiceProgress,
  subscribeVoiceState,
} from './voice-player-registry';
import type { VoicePlayerControls } from './voice-player-host';
import { Text } from '@/components/ui/text';
import { useKeyPress } from '@/components/ui/use-key-press';
import { interruptFiber } from '@zilar/client-core';
import { mobileUploadOf } from '@/lib/types';
import { voiceAudioSource, type VoicePlayback, type VoiceSpeed } from '@/lib/voice-playback';
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
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import type { UiMessage } from '@zilar/chat-core';

type TranscribeConfirmProps = {
  open: boolean;
  busy: boolean;
  onDownload: () => void;
  onClose: () => void;
};

// The one-time model download confirm: "Download the transcription model? 17 MB, once. Everything stays on your phone." While busy the backdrop does nothing.
function VoiceTranscribeConfirm({ open, busy, onDownload, onClose }: TranscribeConfirmProps) {
  if (!open) {
    return null;
  }
  return (
    <ConfirmDialog
      visible={open}
      title="Download the transcription model?"
      message="17 MB, once. Everything stays on your phone."
      confirmLabel="Download"
      busyLabel="Downloading…"
      busy={busy}
      destructive={false}
      onConfirm={onDownload}
      onCancel={busy ? () => {} : onClose}
      confirmAccessibilityLabel="Download transcription model"
      cancelAccessibilityLabel="Cancel transcription download"
      accessibilityLabel="Download the transcription model"
    />
  );
}

type VoiceMessageProps = {
  voice: VoiceMeta;
  outgoing: boolean;
  message: UiMessage;
  onRetryVoice?: ((message: UiMessage) => void) | undefined;
  onCancelVoice?: ((message: UiMessage) => void) | undefined;
  playback?: VoicePlayback | undefined;
  controls?: VoicePlayerControls | undefined;
  whistle?: WhistlePort | undefined;
  transcripts?: TranscriptMap | undefined;
  onSaveTranscript?: ((id: string, entry: StoredTranscript) => Promise<void> | void) | undefined;
};

// A voice bubble: play/pause, progress bar, elapsed/total time and a speed toggle. A local file plays while it uploads, then the served URL (trusted hosts only; an untrusted voice never fetches). One voice plays at a time; the Whistle engine transcribes on-device and keeps the text on the phone.
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

  // Claiming only records UI state: the shared player is never paused as a side effect of switching.
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
        : voice.url !== undefined && isLoadableMediaUrl(voice.url, hosts);

  // The voice bubble's transcription half: on-device state, the stored transcript read, and the transcribe/confirm flow. The bubble and bars only render.
  const [showTranscript, setShowTranscript] = useState(false);
  // The on-device transcript, kept locally (never on the wire): the stored value wins, then this session's fresh text.
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
  // The one-shot model-download consent: set only by the sheet's Download for this run, consumed by `confirmDownload`.
  const transcribeConsent = useRef({ confirmed: false });

  // A stored transcript is shown at once on the next start; read here when the caller injected none.
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
      interruptFiber(reading);
    };
  }, [transcripts, message.id]);

  const storedText = storedTranscripts?.[message.id];
  const transcriptText = storedText ?? localText;
  const hasTranscript = transcriptText !== undefined || voice.transcript !== undefined;
  const shownText = transcriptText?.text ?? voice.transcript?.text;
  const localTranscript = transcriptText !== undefined;
  const toggleTranscript = () => setShowTranscript((value) => !value);

  // Transcribe shows only on phones with the engine, with no transcript yet, and with playable audio. The engine probe is synchronous and safe (it only reads the ABI list).
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
    // The model download needs the user's yes: Download sets `transcribeConsent` for this run and the gate consumes it; no yes, no download.
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
      // A local file transcribes in place; a served URL downloads to the cache with its headers (the flow always deletes the cached file).
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
    // The user's yes must be fresh: a previous confirm never carries over; the model check decides whether the sheet opens.
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

  const closeConfirm = () => setConfirmOpen(false);

  // Resolves the source lazily on play (the bearer must be fresh), with a request-id guard so a stale resolve loses to the last tap.
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
