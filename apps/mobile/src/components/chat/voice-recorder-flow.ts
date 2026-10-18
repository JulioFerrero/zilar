import { Effect } from 'effect';

import { VOICE_MAX_BYTES, VOICE_MAX_DURATION_MS, VOICE_MIN_MS } from '@/lib/voice';
import {
  RECORD_TOO_LONG_MESSAGE,
  type FinishedRecording,
  type VoiceRecorderPort as RecorderPort,
} from '@/lib/voice-native';
import type { ReplyRef } from '@/lib/types';
import type { SendTextOptions, SendVoiceRecording } from '@/store/types';

// The recorder button's decision logic, extracted so tests drive the same steps the component runs (`begin` → `finish`).

export type RecorderDecisionDeps = {
  recorder: RecorderPort;
  onSendVoice: (recording: SendVoiceRecording, options?: SendTextOptions) => void;
  onCancelReply: () => void;
  replyTo?: ReplyRef;
  waveformFor?: ((durationMs: number) => number[]) | undefined;
};

function flatWaveform(durationMs: number): number[] {
  const buckets = Math.min(64, Math.max(8, Math.round(durationMs / 1000) * 4));
  return Array.from({ length: buckets }, () => 12);
}

/** How often the input level is sampled while recording. */
export const LEVEL_TICK_MS = 100;
/** An error hint disappears by itself after this long. */
export const ERROR_VISIBLE_MS = 3000;
/** A too-short press shows the hold hint for this long. */
export const SHORT_PRESS_HINT_MS = 1500;
const WAVEFORM_BARS = 48;

// At most 48 bars, each the loudest sample of its slice, as 6..255 integers; metering unavailable falls back to the flat placeholder.
export function waveformFromLevels(levels: readonly number[], durationMs: number): number[] {
  if (levels.length === 0) {
    return flatWaveform(durationMs);
  }
  const bars = Math.min(WAVEFORM_BARS, levels.length);
  return Array.from({ length: bars }, (_, index) => {
    const from = Math.floor((index * levels.length) / bars);
    const to = Math.max(from + 1, Math.floor(((index + 1) * levels.length) / bars));
    const peak = Math.max(...levels.slice(from, to));
    return Math.max(6, Math.min(255, Math.round(peak * 255)));
  });
}

// Asks the recorder to start and reports the denied copy when permission is refused. The caller owns the `starting` re-entry guard.
export type RecorderBeginResult = { started: true } | { started: false; error: string };

export function runRecorderBeginEffect(
  deps: RecorderDecisionDeps,
): Effect.Effect<RecorderBeginResult, unknown> {
  return Effect.tryPromise({ try: () => deps.recorder.start(), catch: (error) => error }).pipe(
    Effect.map((started): RecorderBeginResult => {
      if (started.status === 'error') {
        return { started: false, error: started.message };
      }
      return { started: true };
    }),
  );
}

export function runRecorderBegin(deps: RecorderDecisionDeps): Promise<RecorderBeginResult> {
  return Effect.runPromise(runRecorderBeginEffect(deps));
}

// Stops (or cancels) and sends or reports the plain copy: `sent`, `cancelled`, `too-short` (discarded through `cancel`, no file left) or `refused` with the copy.
export type RecorderFinishOutcome =
  | { kind: 'sent' }
  | { kind: 'cancelled' }
  | { kind: 'too-short' }
  | { kind: 'refused'; copy: string };

export function runRecorderFinish(
  deps: RecorderDecisionDeps,
  cancel: boolean,
): Promise<RecorderFinishOutcome> {
  return Effect.runPromise(runRecorderFinishEffect(deps, cancel));
}

export function runRecorderFinishEffect(
  deps: RecorderDecisionDeps,
  cancel: boolean,
): Effect.Effect<RecorderFinishOutcome, unknown> {
  return Effect.gen(function* () {
    const discard = Effect.tryPromise(() => deps.recorder.cancel()).pipe(Effect.ignore);
    if (cancel) {
      yield* discard;
      return { kind: 'cancelled' } as const;
    }
    // A press shorter than the minimum is a miss press: checked before stopping so the take is discarded with `cancel`, no file left. A failed duration read falls through to `stop`.
    const liveMs = yield* Effect.try(() => deps.recorder.currentDurationMs()).pipe(
      Effect.orElseSucceed(() => undefined),
    );
    if (liveMs !== undefined && liveMs < VOICE_MIN_MS) {
      yield* discard;
      return { kind: 'too-short' } as const;
    }
    const result = yield* Effect.tryPromise({
      try: () => deps.recorder.stop(),
      catch: (error) => error,
    });
    if (result.status === 'cancelled') {
      return { kind: 'cancelled' } as const;
    }
    if (result.status === 'error') {
      return { kind: 'refused', copy: result.message } as const;
    }
    const finished: FinishedRecording = result.recording;
    if (finished.durationMs < VOICE_MIN_MS) {
      return { kind: 'too-short' } as const;
    }
    if (finished.durationMs > VOICE_MAX_DURATION_MS || finished.size > VOICE_MAX_BYTES) {
      return { kind: 'refused', copy: RECORD_TOO_LONG_MESSAGE } as const;
    }
    const build = deps.waveformFor ?? flatWaveform;
    deps.onSendVoice(
      {
        uri: finished.uri,
        mimeType: finished.mimeType,
        size: finished.size,
        durationMs: finished.durationMs,
        waveform: build(finished.durationMs),
      },
      deps.replyTo === undefined ? undefined : { replyTo: deps.replyTo },
    );
    deps.onCancelReply();
    return { kind: 'sent' } as const;
  });
}

export function formatElapsed(durationMs: number): string {
  const totalSeconds = Math.max(0, Math.floor(durationMs / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}
