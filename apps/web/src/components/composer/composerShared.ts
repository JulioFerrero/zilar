import { Data, Effect, Fiber } from 'effect';
import {
  type Dispatch,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
  type SetStateAction,
} from 'react';
import type { VoiceRecorder } from '@/lib/voice';

export interface PressState {
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
