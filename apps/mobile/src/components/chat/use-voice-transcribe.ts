import type { VoiceMeta } from '@zilar/protocol';
import { Effect, Fiber } from 'effect';
import { useEffect, useMemo, useRef, useState } from 'react';

import { isPromiseLike } from './voice-playback-source';
import { voiceAudioSource } from '@/lib/voice-native';
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

export type VoiceTranscribeState = {
  showTranscript: boolean;
  toggleTranscript: () => void;
  shownText: string | undefined;
  localTranscript: boolean;
  showTranscribe: boolean;
  transcribeBusy: boolean;
  transcribePhase: TranscribePhase | undefined;
  transcribeError: string | undefined;
  confirmOpen: boolean;
  startTranscribe: () => void;
  confirmTranscribe: () => void;
  closeConfirm: () => void;
};

/**
 * The voice bubble's transcription half (T-0179): the on-device state, the
 * stored-transcript read, and the transcribe/confirm flow. The rendered
 * structure stays in the bubble and the bars; this hook owns the logic.
 */
export function useVoiceTranscribe(input: {
  voice: VoiceMeta;
  messageId: string;
  localUri: string | undefined;
  trustedHosts: ReadonlySet<string>;
  playable: boolean;
  transcripts: TranscriptMap | undefined;
  whistle: WhistlePort | undefined;
  onSaveTranscript?: ((id: string, entry: StoredTranscript) => Promise<void> | void) | undefined;
}): VoiceTranscribeState {
  const {
    voice,
    messageId,
    localUri,
    trustedHosts,
    playable,
    transcripts,
    whistle,
    onSaveTranscript,
  } = input;
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
  }, [transcripts, messageId]);

  const storedText = storedTranscripts?.[messageId];
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
        voiceAudioSource({ voice, localUri, trustedHosts }),
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
        localUri !== undefined && localUri !== ''
          ? { localUri }
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
      setStoredTranscripts((current) => ({ ...current, [messageId]: entry }));
      // The text is already on screen; a blocked store keeps it local.
      yield* Effect.try(
        () => onSaveTranscript?.(messageId, entry) ?? saveTranscript(messageId, entry),
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

  return {
    showTranscript,
    toggleTranscript: () => setShowTranscript((value) => !value),
    shownText,
    localTranscript: transcriptText !== undefined,
    showTranscribe,
    transcribeBusy,
    transcribePhase,
    transcribeError,
    confirmOpen,
    startTranscribe,
    confirmTranscribe,
    closeConfirm: () => setConfirmOpen(false),
  };
}
