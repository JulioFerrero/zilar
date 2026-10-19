import { Effect, Fiber } from 'effect';
import * as Haptics from 'expo-haptics';
import { Lock, Mic, ArrowUp, ChevronLeft, Trash2 } from 'lucide-react-native';
import { useEffect, useRef, useState } from 'react';
import { Pressable, View, type GestureResponderHandlers, PanResponder } from 'react-native';
import { Text } from '@/components/ui/text';
import { ICON } from '@/lib/colors';
import { interruptFiber } from '@zilar/client-core';
import { ACCENT_FOREGROUND, primaryKey, KEY_PRIMARY_PRESSED_SHADOW, pressStyle } from '@/lib/depth';
import { VOICE_MAX_BYTES, VOICE_MAX_DURATION_MS, VOICE_MIN_MS } from '@/lib/voice';
import {
  createVoiceRecorder,
  MIC_FAILED_MESSAGE,
  RECORD_TOO_LONG_MESSAGE,
  type FinishedRecording,
  type VoiceRecorderPort,
} from '@/lib/voice-recorder';
import type { SendTextOptions, SendVoiceRecording } from '@/store/types';
import { useKeyPress } from '@/components/ui/use-key-press';
import type { ReplyRef } from '@zilar/chat-core';

type VoiceRecordingRowProps = {
  elapsedMs: number;
  willCancel: boolean;
  locked: boolean;
  onCancel: () => void;
  onSend: () => void;
};

function RecordingMeta({ elapsedMs }: { elapsedMs: number }) {
  return (
    <>
      <View className="size-2.5 shrink-0 rounded-full bg-danger" />
      <Text className="shrink-0 font-mono text-[15px] tabular-nums text-foreground">
        {formatElapsed(elapsedMs)}
      </Text>
    </>
  );
}

// The row that replaces the composer while recording. With the finger still down it shows the slide-to-cancel hint; once locked the finger has lifted, so it swaps to a Cancel key and a Send key.
function VoiceRecordingRow({
  elapsedMs,
  willCancel,
  locked,
  onCancel,
  onSend,
}: VoiceRecordingRowProps) {
  const { pressed, reduceMotion, setPressed } = useKeyPress();
  return (
    <View className="h-9 min-w-0 flex-1 flex-row items-center gap-3 px-1">
      <RecordingMeta elapsedMs={elapsedMs} />
      {locked ? (
        <>
          <View className="flex-1" />
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Cancel recording"
            hitSlop={8}
            onPress={onCancel}
            className="h-9 w-9 items-center justify-center rounded-[10px]"
          >
            <Trash2 size={18} color={ICON} />
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Send voice message"
            onPress={onSend}
            onPressIn={() => setPressed(true)}
            onPressOut={() => setPressed(false)}
            className="h-9 w-9 items-center justify-center rounded-[10px]"
            style={[primaryKey, pressStyle(pressed, KEY_PRIMARY_PRESSED_SHADOW, reduceMotion)]}
          >
            <ArrowUp size={20} color={ACCENT_FOREGROUND} />
          </Pressable>
        </>
      ) : willCancel ? (
        <Text numberOfLines={1} className="min-w-0 flex-1 text-center text-[13px] text-danger">
          Release to cancel
        </Text>
      ) : (
        <View className="min-w-0 flex-1 flex-row items-center justify-center gap-1">
          <ChevronLeft size={14} color={ICON} />
          <Text numberOfLines={1} className="text-[13px] text-muted-foreground">
            Slide to cancel
          </Text>
        </View>
      )}
      {!locked ? <Trash2 size={18} color={willCancel ? '#f87171' : ICON} /> : null}
    </View>
  );
}

/** Sliding the finger this far left (negative dx, in px) while holding cancels. */
const CANCEL_SLIDE_PX = -90;
/** Sliding the finger this far up (negative dy, in px) while holding locks. */
const LOCK_SLIDE_PX = -70;

type HoldHandlers = {
  begin: () => void;
  release: (cancel: boolean) => void;
  lock: () => void;
};
type FlagRef = { current: boolean };
type TickerRef = { current: Fiber.Fiber<unknown, unknown> | undefined };

// Runs `tick` every `everyMs` (first after one interval) until interrupted; a throw inside one tick is dropped, so the next still runs, like `setInterval`.
function startTicker(everyMs: number, tick: () => void): Fiber.Fiber<unknown, unknown> {
  const safeTick = Effect.sync(tick).pipe(Effect.catchDefect(() => Effect.void));
  return Effect.runFork(Effect.sleep(everyMs).pipe(Effect.andThen(safeTick), Effect.forever));
}

function stopTicker(ref: TickerRef): void {
  const fiber = ref.current;
  if (fiber !== undefined) {
    ref.current = undefined;
    interruptFiber(fiber);
  }
}

// The hold gesture on the mic: grant starts, release sends, a slide past `CANCEL_SLIDE_PX` or a lost touch cancels. A slide up past `LOCK_SLIDE_PX` locks once; then release neither sends nor cancels and the row's buttons end it.
function createHoldResponder(
  handlersRef: { current: HoldHandlers },
  heldRef: FlagRef,
  cancelRef: FlagRef,
  lockedRef: FlagRef,
  setWillCancel: (value: boolean) => void,
) {
  return PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    // A lost touch (a permission dialog, a scroll takeover) cancels the recording instead of continuing silently.
    onPanResponderTerminationRequest: () => false,
    onPanResponderGrant: () => {
      heldRef.current = true;
      cancelRef.current = false;
      lockedRef.current = false;
      handlersRef.current.begin();
    },
    onPanResponderMove: (_event, gesture) => {
      if (lockedRef.current) {
        return;
      }
      const willCancel = gesture.dx < CANCEL_SLIDE_PX;
      setWillCancel(willCancel);
      if (!willCancel && gesture.dy < LOCK_SLIDE_PX) {
        lockedRef.current = true;
        setWillCancel(false);
        handlersRef.current.lock();
      }
    },
    onPanResponderRelease: (_event, gesture) => {
      if (lockedRef.current) {
        return;
      }
      handlersRef.current.release(gesture.dx < CANCEL_SLIDE_PX);
    },
    onPanResponderTerminate: () => {
      if (lockedRef.current) {
        return;
      }
      handlersRef.current.release(true);
    },
  });
}

type VoiceRecorderProps = {
  onSendVoice: (recording: SendVoiceRecording, options?: SendTextOptions) => void;
  replyTo?: ReplyRef;
  onCancelReply: () => void;
  canSend: boolean;
  /** The recorder; tests inject a fake so no microphone is needed. */
  recorder?: VoiceRecorderPort | undefined;
  waveformFor?: ((durationMs: number) => number[]) | undefined;
  disabled?: boolean | undefined;
  /** Tells the composer when a recording is active, so it can hide the other controls. */
  onRecordingChange?: ((recording: boolean) => void) | undefined;
};

/** How often the recording row re-reads the live duration. */
const TIMER_TICK_MS = 250;

// Hold to record, release to send, slide left to cancel, slide up to lock. The mic stays mounted under the finger for the whole unlocked hold (a remount would drop the touch). Under one second is a miss press, discarded with a hint.
export function VoiceRecorderButton({
  onSendVoice,
  replyTo,
  onCancelReply,
  canSend,
  recorder: recorderProp,
  waveformFor,
  disabled = false,
  onRecordingChange,
}: VoiceRecorderProps) {
  const [recorder] = useState<VoiceRecorderPort>(() => recorderProp ?? createVoiceRecorder());
  const [recording, setRecording] = useState(false);
  useEffect(() => {
    onRecordingChange?.(recording);
  }, [recording, onRecordingChange]);
  const [willCancel, setWillCancel] = useState(false);
  const [locked, setLocked] = useState(false);
  const levelsRef = useRef<number[]>([]);
  const levelTimerRef: TickerRef = useRef<Fiber.Fiber<unknown, unknown> | undefined>(undefined);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [error, setError] = useState<string | undefined>(undefined);
  useEffect(() => {
    if (error === undefined) {
      return undefined;
    }
    const hide = Effect.runFork(
      Effect.sleep(ERROR_VISIBLE_MS).pipe(Effect.andThen(Effect.sync(() => setError(undefined)))),
    );
    return () => {
      interruptFiber(hide);
    };
  }, [error]);
  // A too-short press shows the hold hint for 1.5 s; the `Effect.sleep` fiber is interrupted by the cleanup.
  const [shortPressHint, setShortPressHint] = useState(false);
  useEffect(() => {
    if (!shortPressHint) {
      return undefined;
    }
    const hide = Effect.runFork(
      Effect.sleep(SHORT_PRESS_HINT_MS).pipe(
        Effect.andThen(Effect.sync(() => setShortPressHint(false))),
      ),
    );
    return () => {
      interruptFiber(hide);
    };
  }, [shortPressHint]);
  const timerRef: TickerRef = useRef<Fiber.Fiber<unknown, unknown> | undefined>(undefined);
  const recordingRef = useRef(false);
  // Set synchronously before the first await, so a double tap cannot create two native recorders.
  const startingRef = useRef(false);

  // Leaving the chat while recording stops the microphone and discards the take (the OS indicator must go off).
  useEffect(
    () => () => {
      stopTicker(timerRef);
      stopTicker(levelTimerRef);
      if (recordingRef.current) {
        recordingRef.current = false;
        Effect.runFork(Effect.tryPromise(() => recorder.cancel()).pipe(Effect.ignore));
      }
    },
    [recorder],
  );

  const stopTimer = () => {
    stopTicker(levelTimerRef);
    stopTicker(timerRef);
  };

  // Releases that arrive before the native recorder finished starting (the first start waits on the permission prompt) are replayed.
  const heldRef = useRef(false);
  const cancelRef = useRef(false);
  const lockedRef = useRef(false);

  // A failed haptic is ignored: the press still works without it.
  const haptic = (style: Haptics.ImpactFeedbackStyle): void => {
    Effect.runFork(
      Effect.tryPromise({
        try: () => Haptics.impactAsync(style),
        catch: (error) => error,
      }).pipe(Effect.ignore),
    );
  };

  const begin = () => {
    if (recordingRef.current || startingRef.current || disabled) {
      return;
    }
    startingRef.current = true;
    setError(undefined);
    // A throw from the native import or the permission request is a handled mic failure, never a silent death.
    const onBegun = (result: RecorderBeginResult): void => {
      if (!result.started) {
        // A failed start must not leave `locked` set with `recording` false, or the composer renders neither row nor mic.
        lockedRef.current = false;
        setLocked(false);
        setError(result.error);
        return;
      }
      haptic(Haptics.ImpactFeedbackStyle.Light);
      recordingRef.current = true;
      setRecording(true);
      setElapsedMs(0);
      levelsRef.current = [];
      levelTimerRef.current = startTicker(LEVEL_TICK_MS, () => {
        levelsRef.current.push(recorder.currentLevel());
      });
      timerRef.current = startTicker(TIMER_TICK_MS, () => {
        const elapsed = recorder.currentDurationMs();
        setElapsedMs(elapsed);
        // The 5-minute cap stops the recording, as the server's `VOICE_MAX_DURATION_MS` refusal would.
        if (elapsed >= VOICE_MAX_DURATION_MS) {
          finish(false);
        }
      });
      if (!heldRef.current) {
        finish(cancelRef.current);
      }
    };
    Effect.runFork(
      runRecorderBeginEffect({ recorder, onSendVoice, onCancelReply, replyTo, waveformFor }).pipe(
        Effect.flatMap((result) =>
          Effect.try({ try: () => onBegun(result), catch: (error) => error }),
        ),
        Effect.catch(() =>
          Effect.sync(() => {
            // A start that throws must not strand a lock taken while it was in flight.
            lockedRef.current = false;
            setLocked(false);
            setError(MIC_FAILED_MESSAGE);
          }),
        ),
        Effect.ensuring(
          Effect.sync(() => {
            startingRef.current = false;
          }),
        ),
      ),
    );
  };

  const finish = (cancel: boolean): void => {
    stopTimer();
    recordingRef.current = false;
    setRecording(false);
    setWillCancel(false);
    lockedRef.current = false;
    setLocked(false);
    if (cancel) {
      haptic(Haptics.ImpactFeedbackStyle.Medium);
    }
    const onFinished = (outcome: RecorderFinishOutcome): void => {
      if (outcome.kind === 'refused') {
        setError(outcome.copy);
      } else if (outcome.kind === 'too-short') {
        setShortPressHint(true);
      }
    };
    const levels = levelsRef.current;
    Effect.runFork(
      runRecorderFinishEffect(
        {
          recorder,
          onSendVoice,
          onCancelReply,
          replyTo,
          waveformFor: waveformFor ?? ((durationMs) => waveformFromLevels(levels, durationMs)),
        },
        cancel,
      ).pipe(
        Effect.flatMap((outcome) =>
          Effect.try({ try: () => onFinished(outcome), catch: (error) => error }),
        ),
        Effect.catch(() => Effect.sync(() => setError(MIC_FAILED_MESSAGE))),
      ),
    );
  };

  const release = (cancel: boolean) => {
    heldRef.current = false;
    cancelRef.current = cancel;
    if (recordingRef.current) {
      finish(cancel);
    }
  };

  // A slide up locks hands-free: the finger may lift and the take runs until Cancel, Send or the 5-minute cap.
  const lock = () => {
    setWillCancel(false);
    setLocked(true);
    haptic(Haptics.ImpactFeedbackStyle.Light);
  };

  const handlersRef = useRef({
    begin: () => {},
    release: (_cancel: boolean) => {},
    lock: () => {},
  });
  useEffect(() => {
    handlersRef.current = { begin, release, lock };
  });

  // Built in an effect: the responder's handlers read refs, which render may not touch.
  const [panHandlers, setPanHandlers] = useState<GestureResponderHandlers>({});
  useEffect(() => {
    setPanHandlers(
      createHoldResponder(handlersRef, heldRef, cancelRef, lockedRef, setWillCancel).panHandlers,
    );
  }, []);

  if (!recording && canSend) {
    return null;
  }

  return (
    <View className={recording ? 'relative min-w-0 flex-1' : 'relative'}>
      <View className="flex-row items-center gap-3">
        {recording ? (
          <VoiceRecordingRow
            elapsedMs={elapsedMs}
            willCancel={willCancel}
            locked={locked}
            onCancel={() => finish(true)}
            onSend={() => finish(false)}
          />
        ) : null}
        {locked ? null : (
          <View
            accessibilityRole="button"
            accessibilityLabel="Hold to record voice message"
            accessibilityHint="Release to send, slide left to cancel, slide up to lock"
            className="h-9 w-9 items-center justify-center rounded-[10px]"
            style={recording ? [primaryKey, { transform: [{ scale: 1.25 }] }] : undefined}
            {...panHandlers}
          >
            <Mic size={20} color={recording ? ACCENT_FOREGROUND : ICON} />
          </View>
        )}
      </View>
      {recording && !locked ? (
        <View className="absolute right-0 bottom-full mb-3 flex-row items-center gap-1.5 rounded-[10px] bg-surface-raised px-3 py-2">
          <Lock size={12} color={ICON} />
          <Text numberOfLines={1} className="text-[12px] text-muted-foreground">
            Slide up to lock
          </Text>
        </View>
      ) : null}
      {shortPressHint ? (
        <View className="absolute right-0 bottom-full mb-3 w-64 rounded-[10px] bg-surface-raised px-3 py-2">
          <Text numberOfLines={2} className="text-[12px] text-muted-foreground">
            Hold to record, release to send
          </Text>
        </View>
      ) : null}
      {error !== undefined ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Dismiss error"
          onPress={() => setError(undefined)}
          className="absolute right-0 bottom-full mb-3 w-64 rounded-[10px] bg-surface-raised px-3 py-2"
        >
          <Text numberOfLines={2} className="text-[12px] text-danger">
            {error}
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}

// The recorder button's decision logic, extracted so tests drive the same steps the component runs (`begin` → `finish`).

type RecorderDecisionDeps = {
  recorder: VoiceRecorderPort;
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
const LEVEL_TICK_MS = 100;
/** An error hint disappears by itself after this long. */
const ERROR_VISIBLE_MS = 3000;
/** A too-short press shows the hold hint for this long. */
const SHORT_PRESS_HINT_MS = 1500;
const WAVEFORM_BARS = 48;

// At most 48 bars, each the loudest sample of its slice, as 6..255 integers; metering unavailable falls back to the flat placeholder.
function waveformFromLevels(levels: readonly number[], durationMs: number): number[] {
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
type RecorderBeginResult = { started: true } | { started: false; error: string };

function runRecorderBeginEffect(
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

// Stops (or cancels) and sends or reports the plain copy: `sent`, `cancelled`, `too-short` (discarded through `cancel`, no file left) or `refused` with the copy.
type RecorderFinishOutcome =
  | { kind: 'sent' }
  | { kind: 'cancelled' }
  | { kind: 'too-short' }
  | { kind: 'refused'; copy: string };

function runRecorderFinishEffect(
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

function formatElapsed(durationMs: number): string {
  const totalSeconds = Math.max(0, Math.floor(durationMs / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}
