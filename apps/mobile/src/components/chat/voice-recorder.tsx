import { Effect, Fiber } from 'effect';
import * as Haptics from 'expo-haptics';
import { ChevronLeft, Mic, Trash2 } from 'lucide-react-native';
import { useEffect, useRef, useState } from 'react';
import { Pressable, View, type GestureResponderHandlers } from 'react-native';

import { Text } from '@/components/ui/text';
import { ICON } from '@/lib/colors';
import { interruptFiber } from '@/lib/effect/timers';
import { ACCENT_FOREGROUND, primaryKey } from '@/lib/depth';
import { VOICE_MAX_DURATION_MS } from '@/lib/voice';
import {
  createVoiceRecorder,
  MIC_FAILED_MESSAGE,
  type VoiceRecorderPort,
} from '@/lib/voice-native';
import type { ReplyRef } from '@/lib/types';
import type { SendTextOptions, SendVoiceRecording } from '@/store/types';

import {
  ERROR_VISIBLE_MS,
  LEVEL_TICK_MS,
  SHORT_PRESS_HINT_MS,
  formatElapsed,
  runRecorderBegin,
  runRecorderBeginEffect,
  runRecorderFinish,
  runRecorderFinishEffect,
  waveformFromLevels,
  type RecorderBeginResult,
  type RecorderDecisionDeps,
  type RecorderFinishOutcome,
} from '@/components/chat/voice-recorder-flow';
import {
  createHoldResponder,
  startTicker,
  stopTicker,
  type TickerRef,
} from '@/components/chat/voice-recorder-gesture';

export {
  runRecorderBegin,
  runRecorderBeginEffect,
  runRecorderFinish,
  runRecorderFinishEffect,
  waveformFromLevels,
};
export type { RecorderBeginResult, RecorderDecisionDeps, RecorderFinishOutcome };

type VoiceRecorderProps = {
  /** Sends the finished recording with the optional reply, like web. */
  onSendVoice: (recording: SendVoiceRecording, options?: SendTextOptions) => void;
  replyTo?: ReplyRef;
  onCancelReply: () => void;
  /** True while the composer has text or a picked file (mic stays hidden). */
  canSend: boolean;
  /** The recorder; tests inject a fake so no microphone is needed. */
  recorder?: VoiceRecorderPort | undefined;
  /** Builds a flat waveform placeholder; tests inject a fake. */
  waveformFor?: ((durationMs: number) => number[]) | undefined;
  disabled?: boolean | undefined;
  /** Tells the composer when a recording is active, so it can hide the other controls. */
  onRecordingChange?: ((recording: boolean) => void) | undefined;
};

/** How often the recording row re-reads the live duration. */
const TIMER_TICK_MS = 250;

/**
 * The composer's mic button (T-0154): hold to record, release to send, slide
 * left while holding to cancel. While holding, a timer row replaces the
 * input: a red dot, the elapsed time and a hint, with a 5-minute cap that
 * stops the recording automatically. The mic stays mounted under the finger
 * for the whole hold (a remount would drop the touch). Under one second is
 * a miss press: the take is discarded with nothing sent, and a "Hold to
 * record, release to send" hint shows above the composer for 1.5 s.
 */
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
  // A too-short press shows the hold hint for 1.5 s, like the error hide
  // above: an `Effect.sleep` forked on a fiber, interrupted by the cleanup.
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
  // Set synchronously before the first await so a double tap cannot create
  // two native recorders (finding 6); cleared once the start settles.
  const startingRef = useRef(false);

  // Leaving the chat while recording stops the microphone and discards the
  // recording (the OS recording indicator must go off).
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

  // Releases that arrive before the native recorder finished starting (the
  // first start waits on the permission prompt) are replayed when it does.
  const heldRef = useRef(false);
  const cancelRef = useRef(false);

  // A failed haptic is ignored: the press itself still works without it
  // (the call style of `swipe-to-reply.tsx` and `message-bubble-actions.tsx`).
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
    // A throw from the native import or the permission request (e.g. the
    // pre-rebuild state) is a handled mic failure, never a silent death
    // (finding 1, round 3): the button shows the failed copy.
    const onBegun = (result: RecorderBeginResult): void => {
      if (!result.started) {
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
        // The 5-minute cap stops the recording automatically, like the
        // server's `VOICE_MAX_DURATION_MS` refusal would.
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
        Effect.catch(() => Effect.sync(() => setError(MIC_FAILED_MESSAGE))),
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

  const handlersRef = useRef({
    begin: () => {},
    release: (_cancel: boolean) => {},
  });
  useEffect(() => {
    handlersRef.current = { begin, release };
  });

  // Built in an effect: the responder's handlers read refs, which render may not touch.
  const [panHandlers, setPanHandlers] = useState<GestureResponderHandlers>({});
  useEffect(() => {
    setPanHandlers(createHoldResponder(handlersRef, heldRef, cancelRef, setWillCancel).panHandlers);
  }, []);

  if (!recording && canSend) {
    return null;
  }

  return (
    <View className={recording ? 'relative min-w-0 flex-1' : 'relative'}>
      <View className="flex-row items-center gap-3">
        {recording ? (
          <View className="h-9 min-w-0 flex-1 flex-row items-center gap-3 px-1">
            <View className="size-2.5 shrink-0 rounded-full bg-danger" />
            <Text className="shrink-0 font-mono text-[15px] tabular-nums text-foreground">
              {formatElapsed(elapsedMs)}
            </Text>
            {willCancel ? (
              <Text
                numberOfLines={1}
                className="min-w-0 flex-1 text-center text-[13px] text-danger"
              >
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
            <Trash2 size={18} color={willCancel ? '#f87171' : ICON} />
          </View>
        ) : null}
        <View
          accessibilityRole="button"
          accessibilityLabel="Hold to record voice message"
          accessibilityHint="Release to send, slide left to cancel"
          className="h-9 w-9 items-center justify-center rounded-[10px]"
          style={recording ? [primaryKey, { transform: [{ scale: 1.25 }] }] : undefined}
          {...panHandlers}
        >
          <Mic size={20} color={recording ? ACCENT_FOREGROUND : ICON} />
        </View>
      </View>
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
