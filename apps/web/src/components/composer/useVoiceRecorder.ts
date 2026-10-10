import type { ReplyRef } from '@zilar/chat-core';
import { Data, Effect, Fiber } from 'effect';
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
  type SetStateAction,
} from 'react';
import {
  VOICE_MAX_BYTES,
  VOICE_MIN_MS,
  VoiceError,
  VoiceRecorder,
  computeWaveform,
} from '@/lib/voice';
import type { StoreApi } from '@/store/atomStore';
import type { ChatStoreState } from '@/store/store';

const SLIDE_CANCEL_PX = 60;
/** A press held past this point is a hold-to-send; a shorter press clicks over to toggle mode. */
const HOLD_MS = 400;
const VOICE_SAVE_FAILED = 'Could not save the recording, try again';

interface PressState {
  /** Client X where the press began, for the slide-to-cancel gesture. */
  startX: number;
  slidToCancel: boolean;
  /** Set on pointer-up when the recorder has not started yet. */
  released: boolean;
  /** Set once the 400 ms hold timer fires. */
  hold: boolean;
  /** Marks a press held past 400 ms as hold-to-send; interrupted on release. */
  holdTimer: Fiber.Fiber<void> | undefined;
}

/** A step of the voice or GIF flow failed; `message` is the fixed sentence shown inline. */
export class ComposerFailure extends Data.TaggedError('ComposerFailure')<{
  readonly message: string;
}> {}

/** Runs `effect` at once and in the background; the caller never waits for it. */
export const fork = (effect: Effect.Effect<void>): void => {
  Effect.runFork(effect);
};

/** The old `clearTimeout` / `clearInterval`: stops a forked timer fiber. */
export const stopTimer = (timer: Fiber.Fiber<unknown, unknown>): void => {
  fork(Fiber.interrupt(timer));
};

export interface VoiceRecorderController {
  recording: boolean;
  locked: boolean;
  elapsedMs: number;
  cancelArmed: boolean;
  voiceError: string | undefined;
  setRecording: Dispatch<SetStateAction<boolean>>;
  setLocked: Dispatch<SetStateAction<boolean>>;
  setCancelArmed: Dispatch<SetStateAction<boolean>>;
  setElapsedMs: Dispatch<SetStateAction<number>>;
  setVoiceError: Dispatch<SetStateAction<string | undefined>>;
  recorderRef: RefObject<VoiceRecorder | null>;
  pressRef: RefObject<PressState | null>;
  recordingRef: RefObject<boolean>;
  cancelRecording: () => boolean;
  finishRecording: (cancel: boolean) => void;
  onMicClick: () => void;
  onMicPointerDown: (event: ReactPointerEvent<HTMLButtonElement>) => void;
  onMicPointerMove: (clientX: number) => void;
  onMicPointerCancel: () => void;
}

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
  /** Click/tap mode: the recording keeps running until Send or Cancel. */
  const [locked, setLocked] = useState(false);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [cancelArmed, setCancelArmed] = useState(false);
  const [voiceError, setVoiceError] = useState<string | undefined>(undefined);
  // Leaving the chat or unmounting while recording stops the microphone
  // tracks (the browser's recording indicator must go off) and discards the
  // recording. The recorder cancels itself; the guards below ignore its
  // late `start()` promise if it resolves afterwards.
  const recorderRef = useRef<VoiceRecorder | null>(null);
  const pressRef = useRef<PressState | null>(null);
  const recordingRef = useRef(false);
  const chatIdRef = useRef(chatId);
  // The document pointer listeners below are registered once, so every
  // callback they reach reads the reply through this ref instead of a
  // stale mount-time closure.
  const replyRef = useRef(replyTo);
  useEffect(() => {
    chatIdRef.current = chatId;
    replyRef.current = replyTo;
  }, [chatId, replyTo]);

  // Escape cancels a click-mode recording (before the textarea's own
  // Escape handlers for pickers, attachments, edits and replies).
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

  // The permission prompt must never cancel the recording: only an
  // explicit release after the recorder has started can finish it. The
  // press is captured in a local so the async `start()` below can tell a
  // stale prompt (chat switched, composer unmounted) from the live one.
  // The reply is read through `replyRef` at send time: it may change while
  // the browser's microphone prompt is showing, and the document pointer
  // listeners below are registered once with a stale closure.
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
          // A press held this long is a hold-to-send: when the recorder starts
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
    // inside the click (the microphone permission needs it); only the wait for
    // the result is an Effect.
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
    // The composer unmounted or the chat switched while the prompt was up.
    if (pressRef.current !== press) {
      recorder.cancel();
      return;
    }
    recorderRef.current = recorder;
    recordingRef.current = true;
    setRecording(true);
    setElapsedMs(0);
    if (clickMode) {
      // Keyboard / assistive-technology activation: no release will arrive,
      // so the recording runs in click mode with Send and Cancel to finish.
      pressRef.current = null;
      setLocked(true);
      return;
    }
    if (press.released) {
      if (press.hold) {
        // A long press released during the prompt still sends: it was
        // always a hold gesture, even though the recorder started late.
        if (press.holdTimer !== undefined) {
          stopTimer(press.holdTimer);
          press.holdTimer = undefined;
        }
        finishRecording(false);
      } else {
        // A short press released during the prompt: the user clicked while
        // the browser asked for permission. Keep recording in click mode
        // instead of silently discarding it. The press is over either way,
        // so its hold timer is cleared.
        if (press.holdTimer !== undefined) {
          stopTimer(press.holdTimer);
          press.holdTimer = undefined;
        }
        pressRef.current = null;
        setLocked(true);
      }
    } else if (press.hold) {
      // The hold threshold passed while the prompt was up, with the button
      // still down: this is a hold-to-send, finished by the release.
    } else {
      // The recorder beat the hold timer with the button still down: this
      // may still become a hold or fall back to click mode on release.
    }
  };

  // Stops the recorder and either sends or discards the result. `cancel`
  // discards (trash button, slide-off, Escape); otherwise the recording is
  // validated and sent through the store. The reply is read through
  // `replyRef`, never a closure: the document pointer listeners below are
  // registered once and would otherwise send a stale mount-time reply.
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

  // Press-and-hold still works for touch and mouse: a press held past
  // 400 ms sends on release (sliding left cancels instead). A shorter
  // press falls back to click mode and keeps recording until Send. The
  // recording starts on pointer-down and ends on pointer-up; a click
  // without pointer events (keyboard activation) starts a click-mode
  // recording instead, with Send and Cancel and no hold timer.
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
    // jsdom has no pointer capture: guard the call so the recording still
    // starts there (and in any browser where capture throws).
    const target = event.currentTarget as HTMLElement & {
      setPointerCapture?: (pointerId: number) => void;
    };
    // Pointer capture is best-effort; the press state still works without it.
    Effect.runSync(
      Effect.ignore(
        Effect.try(() => {
          target.setPointerCapture?.(event.pointerId);
        }),
      ),
    );
    beginRecording(event.clientX, false);
  };

  // The slide-to-cancel gesture while holding: shared with the document
  // pointer-move listener below.
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
    // The system took over the gesture (an alert, a call): keep a started
    // recording in click mode rather than silently dropping it, but do not
    // resurrect a prompt that failed before starting.
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
