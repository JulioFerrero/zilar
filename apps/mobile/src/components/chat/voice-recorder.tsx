import { Effect, Fiber } from 'effect';
import * as Haptics from 'expo-haptics';
import { Lock, Mic } from 'lucide-react-native';
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
  runRecorderBegin,
  runRecorderBeginEffect,
  runRecorderFinish,
  runRecorderFinishEffect,
  waveformFromLevels,
  type RecorderBeginResult,
  type RecorderDecisionDeps,
  type RecorderFinishOutcome,
} from '@/components/chat/voice-recorder-flow';
import { VoiceRecordingRow } from '@/components/chat/voice-recording-row';
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
