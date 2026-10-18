import { Data, Effect, Fiber } from 'effect';
import {
  type Dispatch,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
  type SetStateAction,
} from 'react';
import type { VoiceRecorder } from '@/lib/voice/recorder';

export interface PressState {
  startX: number;
  slidToCancel: boolean;
  released: boolean;
  hold: boolean;
  holdTimer: Fiber.Fiber<void> | undefined;
}

export class ComposerFailure extends Data.TaggedError('ComposerFailure')<{
  readonly message: string;
}> {}

export const fork = (effect: Effect.Effect<void>): void => {
  Effect.runFork(effect);
};

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
