import { Effect } from 'effect';

import { VOICE_MAX_BYTES, VOICE_MAX_DURATION_MS, VOICE_MIN_MS } from '@/lib/voice';
import {
  RECORD_TOO_LONG_MESSAGE,
  type FinishedRecording,
  type VoiceRecorderPort as RecorderPort,
} from '@/lib/voice-native';
import type { ReplyRef } from '@/lib/types';
import type { SendTextOptions, SendVoiceRecording } from '@/store/types';

/**
 * The recorder button's decision logic, extracted so tests drive the exact
 * behaviour the component runs (finding 5): permission-denied copy with no
 * recorder created, the sub-1s miss press with nothing sent and no hint, the
 * too-long refusal, and the happy path. The component calls the same steps in
 * the same order (`begin` → `finish`), so these tests pin its behaviour.
 */

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
const WAVEFORM_BARS = 48;

/**
 * Turns the sampled input levels (0..1) into the sent waveform: at most 48
 * bars, each the loudest sample of its slice, as 6..255 integers. No samples
 * (metering unavailable) falls back to the flat placeholder.
 */
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

/**
 * Runs `begin`: asks the recorder to start and reports the denied copy when
 * the permission is refused. Resolves true once recording, false otherwise.
 * The caller owns the `starting` re-entry guard (see the component).
 */
export type RecorderBeginResult = { started: true } | { started: false; error: string };

/** The Effect behind `runRecorderBegin`: a rejected start fails with the original error. */
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

/**
 * Runs `finish`: stops (or cancels) and either sends or reports the plain
 * copy. Returns the copy when the recording is refused, so the component
 * can show it; returns undefined when the flow completes, is cancelled, or
 * the press was too short to be a real recording (a miss press records
 * nothing and says nothing). A too-short recording is discarded through the
 * recorder's `cancel`, so no file is left behind.
 */
export function runRecorderFinish(
  deps: RecorderDecisionDeps,
  cancel: boolean,
): Promise<string | undefined> {
  return Effect.runPromise(runRecorderFinishEffect(deps, cancel));
}

/** The Effect behind `runRecorderFinish`: a rejected `stop` fails with the original error. */
export function runRecorderFinishEffect(
  deps: RecorderDecisionDeps,
  cancel: boolean,
): Effect.Effect<string | undefined, unknown> {
  return Effect.gen(function* () {
    const discard = Effect.tryPromise(() => deps.recorder.cancel()).pipe(Effect.ignore);
    if (cancel) {
      yield* discard;
      return undefined;
    }
    // A press shorter than the minimum is a miss press, not a recording: the
    // live duration is checked before stopping so the take is discarded with
    // `cancel` (no file is left behind) instead of `stop`. Nothing is sent and
    // no hint appears; a failure of the duration read falls through to `stop`
    // and the post-stop guard below.
    const liveMs = yield* Effect.try(() => deps.recorder.currentDurationMs()).pipe(
      Effect.orElseSucceed(() => undefined),
    );
    if (liveMs !== undefined && liveMs < VOICE_MIN_MS) {
      yield* discard;
      return undefined;
    }
    const result = yield* Effect.tryPromise({
      try: () => deps.recorder.stop(),
      catch: (error) => error,
    });
    if (result.status === 'cancelled') {
      return undefined;
    }
    if (result.status === 'error') {
      return result.message;
    }
    const finished: FinishedRecording = result.recording;
    if (finished.durationMs < VOICE_MIN_MS) {
      return undefined;
    }
    if (finished.durationMs > VOICE_MAX_DURATION_MS || finished.size > VOICE_MAX_BYTES) {
      return RECORD_TOO_LONG_MESSAGE;
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
    return undefined;
  });
}

export function formatElapsed(durationMs: number): string {
  const totalSeconds = Math.max(0, Math.floor(durationMs / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}
