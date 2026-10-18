import type { ReplyRef } from '@zilar/chat-core';
import { Effect } from 'effect';
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import {
  VOICE_MAX_BYTES,
  VOICE_MIN_MS,
  WAVEFORM_BUCKETS,
  VoiceError,
  VoiceRecorder,
} from '@/lib/voice/recorder';
import type { StoreApi } from '@zilar/client-core';
import type { ChatStoreState } from '@/store/store';
import {
  ComposerFailure,
  fork,
  stopTimer,
  type PressState,
  type VoiceRecorderController,
} from './composerShared';
import { promiseOf } from '../../lib/voice/convert';

/** Peak buckets for the bubble. Decoding uses AudioContext; any failure (or a browser
 * without it, like jsdom) falls back to a quiet flat waveform. */
function computeWaveform(blob: Blob, buckets = WAVEFORM_BUCKETS): Promise<number[]> {
  return promiseOf(() => computeWaveformEffect(blob, buckets));
}

function peaksOf(decoded: AudioBuffer, buckets: number): number[] {
  const channel = decoded.getChannelData(0);
  const perBucket = Math.max(1, Math.floor(channel.length / buckets));
  const peaks: number[] = [];
  for (let bucket = 0; bucket < buckets; bucket += 1) {
    const start = bucket * perBucket;
    const end = Math.min(channel.length, start + perBucket);
    let peak = 0;
    for (let index = start; index < end; index += 1) {
      const value = Math.abs(channel[index] ?? 0);
      if (value > peak) {
        peak = value;
      }
    }
    peaks.push(Math.min(255, Math.round(peak * 255)));
  }
  return peaks;
}

const computeWaveformEffect = (blob: Blob, buckets = WAVEFORM_BUCKETS): Effect.Effect<number[]> =>
  Effect.suspend(() => {
    const fallback = Array.from({ length: buckets }, () => 12);
    const AudioContextCtor = typeof AudioContext === 'undefined' ? undefined : AudioContext;
    if (AudioContextCtor === undefined) {
      return Effect.succeed(fallback);
    }
    // The context is closed after every outcome; a failed close is ignored.
    return Effect.acquireUseRelease(
      Effect.try(() => new AudioContextCtor()),
      (context) =>
        Effect.gen(function* () {
          const bytes = yield* Effect.tryPromise(() => blob.arrayBuffer());
          const decoded = yield* Effect.tryPromise(() => context.decodeAudioData(bytes));
          return yield* Effect.try(() => peaksOf(decoded, buckets));
        }),
      (context) =>
        Effect.suspend(() => {
          const closing = context.close();
          return Effect.tryPromise(() => closing).pipe(Effect.ignore);
        }),
    ).pipe(Effect.orElseSucceed(() => fallback));
  });

const SLIDE_CANCEL_PX = 60;
/** A press held past this point is a hold-to-send; a shorter press clicks over to toggle mode. */
const HOLD_MS = 400;
const VOICE_SAVE_FAILED = 'Could not save the recording, try again';

export function useVoiceRecorder({
  chatId,
  replyTo,
  onCancelReply,
  storeApi,
  canSend,
}: {
  chatId: string;
  replyTo: ReplyRef | undefined;
  onCancelReply: () => void;
  storeApi: StoreApi<ChatStoreState>;
  canSend: boolean;
}): VoiceRecorderController {
  const [recording, setRecording] = useState(false);
  const [locked, setLocked] = useState(false);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [cancelArmed, setCancelArmed] = useState(false);
  const [voiceError, setVoiceError] = useState<string | undefined>(undefined);
  // Leaving the chat or unmounting while recording stops the microphone tracks
  // (the browser's recording indicator must go off) and discards the recording.
  const recorderRef = useRef<VoiceRecorder | null>(null);
  const pressRef = useRef<PressState | null>(null);
  const recordingRef = useRef(false);
  const chatIdRef = useRef(chatId);
  const replyRef = useRef(replyTo);
  useEffect(() => {
    chatIdRef.current = chatId;
    replyRef.current = replyTo;
  }, [chatId, replyTo]);

  // Escape cancels a click-mode recording, before the textarea's own Escape
  // handlers for pickers, attachments, edits and replies.
  const cancelRecording = useCallback((): boolean => {
    if (!recordingRef.current) {
      return false;
    }
    if (pressRef.current?.holdTimer !== undefined) {
      stopTimer(pressRef.current.holdTimer);
    }
    pressRef.current = null;
    const recorder = recorderRef.current;
    recorderRef.current = null;
    recordingRef.current = false;
    recorder?.cancel();
    setRecording(false);
    setLocked(false);
    setCancelArmed(false);
    return true;
  }, []);

  // The permission prompt must never cancel the recording: only an explicit
  // release after the recorder has started can finish it. The press is captured
  // in a local so the async `start()` can tell a stale prompt (chat switched,
  // composer unmounted) from the live one.
  const beginRecording = (startX: number, clickMode: boolean): void => {
    const press: PressState = {
      startX,
      slidToCancel: false,
      released: false,
      hold: false,
      holdTimer: undefined,
    };
    pressRef.current = press;
    setVoiceError(undefined);
    setElapsedMs(0);
    setLocked(false);
    setCancelArmed(false);
    if (!clickMode) {
      press.holdTimer = Effect.runFork(
        Effect.sleep(HOLD_MS).pipe(
          // A press held this long (400 ms) is a hold-to-send: when the recorder starts
          // it runs in hold mode until release.
          Effect.andThen(
            Effect.sync(() => {
              press.hold = true;
            }),
          ),
        ),
      );
    }
    // `runFork` starts the fiber at once, so `VoiceRecorder.start()` still runs
    // inside the click (the microphone permission needs it).
    fork(
      Effect.tryPromise({
        try: () => VoiceRecorder.start(),
        catch: (error) =>
          new ComposerFailure({
            message: error instanceof VoiceError ? error.message : 'Microphone unavailable',
          }),
      }).pipe(
        Effect.match({
          onFailure: (failure) => onRecorderFailed(press, failure.message),
          onSuccess: (recorder) => onRecorderStarted(press, recorder, clickMode),
        }),
      ),
    );
  };

  const onRecorderFailed = (press: PressState, message: string): void => {
    if (pressRef.current !== press) {
      return;
    }
    if (press.holdTimer !== undefined) {
      stopTimer(press.holdTimer);
      press.holdTimer = undefined;
    }
    pressRef.current = null;
    setVoiceError(message);
  };

  const onRecorderStarted = (
    press: PressState,
    recorder: VoiceRecorder,
    clickMode: boolean,
  ): void => {
    if (pressRef.current !== press) {
      recorder.cancel();
      return;
    }
    recorderRef.current = recorder;
    recordingRef.current = true;
    setRecording(true);
    setElapsedMs(0);
    if (clickMode) {
      pressRef.current = null;
      setLocked(true);
      return;
    }
    if (press.released) {
      if (press.hold) {
        if (press.holdTimer !== undefined) {
          stopTimer(press.holdTimer);
          press.holdTimer = undefined;
        }
        finishRecording(false);
      } else {
        if (press.holdTimer !== undefined) {
          stopTimer(press.holdTimer);
          press.holdTimer = undefined;
        }
        pressRef.current = null;
        setLocked(true);
      }
    } else if (press.hold) {
    } else {
    }
  };

  // The reply is read through `replyRef`, never a closure: the document pointer
  // listeners are registered once and would otherwise send a stale reply.
  const finishRecording = (cancel: boolean): void => {
    const press = pressRef.current;
    const recorder = recorderRef.current;
    pressRef.current = null;
    recorderRef.current = null;
    recordingRef.current = false;
    setRecording(false);
    setLocked(false);
    setCancelArmed(false);
    if (recorder === null) {
      return;
    }
    if (cancel || press?.slidToCancel === true) {
      recorder.cancel();
      return;
    }

    const saveFailed = (): ComposerFailure => new ComposerFailure({ message: VOICE_SAVE_FAILED });
    fork(
      Effect.gen(function* () {
        const recorded = yield* Effect.tryPromise({
          try: () => recorder.stop(),
          catch: saveFailed,
        });
        if (recorded.durationMs < VOICE_MIN_MS) {
          return yield* Effect.fail(new ComposerFailure({ message: 'Recording too short' }));
        }
        if (recorded.blob.size > VOICE_MAX_BYTES) {
          return yield* Effect.fail(new ComposerFailure({ message: 'Recording is too long' }));
        }
        const reply = replyRef.current;
        const waveform = yield* Effect.tryPromise({
          try: () => computeWaveform(recorded.blob),
          catch: saveFailed,
        });
        yield* Effect.try({
          try: () =>
            storeApi
              .getState()
              .sendVoice(
                chatIdRef.current,
                { blob: recorded.blob, durationMs: recorded.durationMs, waveform },
                reply === undefined ? undefined : { replyTo: reply },
              ),
          catch: saveFailed,
        });
        onCancelReply();
      }).pipe(
        Effect.catchTag('ComposerFailure', (failure) =>
          Effect.sync(() => setVoiceError(failure.message)),
        ),
      ),
    );
  };

  const onMicClick = (): void => {
    if (pressRef.current !== null || canSend || recordingRef.current) {
      return;
    }
    beginRecording(0, true);
  };

  const onMicPointerDown = (event: ReactPointerEvent<HTMLButtonElement>): void => {
    if (canSend || recordingRef.current || pressRef.current !== null) {
      return;
    }
    event.preventDefault();
    // jsdom has no pointer capture: guard the call so the recording still starts
    // there (and in browsers where capture throws).
    const target = event.currentTarget as HTMLElement & {
      setPointerCapture?: (pointerId: number) => void;
    };
    Effect.runSync(
      Effect.ignore(
        Effect.try(() => {
          target.setPointerCapture?.(event.pointerId);
        }),
      ),
    );
    beginRecording(event.clientX, false);
  };

  const onMicPointerMove = (clientX: number): void => {
    const press = pressRef.current;
    if (press === null || recorderRef.current === null) {
      return;
    }
    const cancel = clientX < press.startX - SLIDE_CANCEL_PX;
    press.slidToCancel = cancel;
    setCancelArmed(cancel);
  };

  const onMicPointerCancel = (): void => {
    const press = pressRef.current;
    if (press?.holdTimer !== undefined) {
      stopTimer(press.holdTimer);
      press.holdTimer = undefined;
    }
    pressRef.current = null;
    if (recorderRef.current !== null) {
      setLocked(true);
    }
  };

  return {
    recording,
    locked,
    elapsedMs,
    cancelArmed,
    voiceError,
    setRecording,
    setLocked,
    setCancelArmed,
    setElapsedMs,
    setVoiceError,
    recorderRef,
    pressRef,
    recordingRef,
    cancelRecording,
    finishRecording,
    onMicClick,
    onMicPointerDown,
    onMicPointerMove,
    onMicPointerCancel,
  };
}
