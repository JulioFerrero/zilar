import { Mic, Trash2 } from 'lucide-react-native';
import { useEffect, useRef, useState } from 'react';
import { PanResponder, Pressable, View, type GestureResponderHandlers } from 'react-native';

import { Text } from '@/components/ui/text';
import { asColorScheme, type ColorScheme } from '@/lib/color-scheme';
import { ICON } from '@/lib/colors';
import { ACCENT_FOREGROUND, primaryKey } from '@/lib/depth';
import { VOICE_MAX_DURATION_MS } from '@/lib/voice';
import {
  createVoiceRecorder,
  MIC_FAILED_MESSAGE,
  type VoiceRecorderPort,
} from '@/lib/voice-native';
import type { ReplyRef } from '@/lib/types';
import type { SendTextOptions, SendVoiceRecording } from '@/store/types';
import { useColorScheme } from 'nativewind';

/**
 * The recorder button's decision logic, extracted so tests drive the exact
 * behaviour the component runs (finding 5): permission-denied copy with no
 * recorder created, the sub-1s refusal with nothing sent, the too-long
 * refusal, and the happy path. The component calls the same steps in the
 * same order (`begin` → `finish`), so these tests pin its behaviour.
 */

import {
  RECORD_TOO_LONG_MESSAGE,
  RECORD_TOO_SHORT_MESSAGE,
  type FinishedRecording,
  type VoiceRecorderPort as RecorderPort,
} from '@/lib/voice-native';
import { VOICE_MAX_BYTES, VOICE_MIN_MS } from '@/lib/voice';

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
const LEVEL_TICK_MS = 100;
/** An error hint disappears by itself after this long. */
const ERROR_VISIBLE_MS = 3000;
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
export async function runRecorderBegin(
  deps: RecorderDecisionDeps,
): Promise<{ started: true } | { started: false; error: string }> {
  const started = await deps.recorder.start();
  if (started.status === 'error') {
    return { started: false, error: started.message };
  }
  return { started: true };
}

/**
 * Runs `finish`: stops (or cancels) and either sends or reports the plain
 * copy. Returns the copy when the recording is refused, so the component
 * can show it; returns undefined when the flow completes or is cancelled.
 */
export async function runRecorderFinish(
  deps: RecorderDecisionDeps,
  cancel: boolean,
): Promise<string | undefined> {
  if (cancel) {
    await deps.recorder.cancel().catch(() => {});
    return undefined;
  }
  const result = await deps.recorder.stop();
  if (result.status === 'cancelled') {
    return undefined;
  }
  if (result.status === 'error') {
    return result.message;
  }
  const finished: FinishedRecording = result.recording;
  if (finished.durationMs < VOICE_MIN_MS) {
    return RECORD_TOO_SHORT_MESSAGE;
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
}

function formatElapsed(durationMs: number): string {
  const totalSeconds = Math.max(0, Math.floor(durationMs / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

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

/** Sliding the finger this far left (negative dx, in px) while holding cancels. */
const CANCEL_SLIDE_PX = -90;

type HoldHandlers = { begin: () => void; release: (cancel: boolean) => void };
type FlagRef = { current: boolean };

/**
 * The hold gesture on the mic: grant starts, release sends, a slide past
 * `CANCEL_SLIDE_PX` or a lost touch cancels. Built outside the component so
 * the handlers may read refs (they only run in touch events).
 */
function createHoldResponder(
  handlersRef: { current: HoldHandlers },
  heldRef: FlagRef,
  cancelRef: FlagRef,
  setWillCancel: (value: boolean) => void,
) {
  return PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    // The system (a permission dialog, a scroll takeover) must not steal the
    // touch silently: a lost touch cancels the recording.
    onPanResponderTerminationRequest: () => false,
    onPanResponderGrant: () => {
      heldRef.current = true;
      cancelRef.current = false;
      handlersRef.current.begin();
    },
    onPanResponderMove: (_event, gesture) => {
      setWillCancel(gesture.dx < CANCEL_SLIDE_PX);
    },
    onPanResponderRelease: (_event, gesture) => {
      handlersRef.current.release(gesture.dx < CANCEL_SLIDE_PX);
    },
    onPanResponderTerminate: () => {
      handlersRef.current.release(true);
    },
  });
}

/**
 * The composer's mic button (T-0154): hold to record, release to send, slide
 * left while holding to cancel. While holding, a timer row replaces the
 * input: a red dot, the elapsed time and a hint, with a 5-minute cap that
 * stops the recording automatically. The mic stays mounted under the finger
 * for the whole hold (a remount would drop the touch). Under one second is
 * refused with the same plain copy as web's "Recording too short".
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
  const scheme: ColorScheme = asColorScheme(useColorScheme().colorScheme);
  const [recorder] = useState<VoiceRecorderPort>(() => recorderProp ?? createVoiceRecorder());
  const [recording, setRecording] = useState(false);
  useEffect(() => {
    onRecordingChange?.(recording);
  }, [recording, onRecordingChange]);
  const [willCancel, setWillCancel] = useState(false);
  const levelsRef = useRef<number[]>([]);
  const levelTimerRef = useRef<ReturnType<typeof setInterval> | undefined>(undefined);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [error, setError] = useState<string | undefined>(undefined);
  useEffect(() => {
    if (error === undefined) {
      return undefined;
    }
    const timer = setTimeout(() => setError(undefined), ERROR_VISIBLE_MS);
    return () => clearTimeout(timer);
  }, [error]);
  const timerRef = useRef<ReturnType<typeof setInterval> | undefined>(undefined);
  const recordingRef = useRef(false);
  // Set synchronously before the first await so a double tap cannot create
  // two native recorders (finding 6); cleared once the start settles.
  const startingRef = useRef(false);

  // Leaving the chat while recording stops the microphone and discards the
  // recording (the OS recording indicator must go off).
  useEffect(
    () => () => {
      if (timerRef.current !== undefined) {
        clearInterval(timerRef.current);
      }
      if (levelTimerRef.current !== undefined) {
        clearInterval(levelTimerRef.current);
      }
      if (recordingRef.current) {
        recordingRef.current = false;
        void recorder.cancel().catch(() => {});
      }
    },
    [recorder],
  );

  const stopTimer = () => {
    if (levelTimerRef.current !== undefined) {
      clearInterval(levelTimerRef.current);
      levelTimerRef.current = undefined;
    }
    if (timerRef.current !== undefined) {
      clearInterval(timerRef.current);
      timerRef.current = undefined;
    }
  };

  // Releases that arrive before the native recorder finished starting (the
  // first start waits on the permission prompt) are replayed when it does.
  const heldRef = useRef(false);
  const cancelRef = useRef(false);

  const begin = () => {
    if (recordingRef.current || startingRef.current || disabled) {
      return;
    }
    startingRef.current = true;
    setError(undefined);
    // A throw from the native import or the permission request (e.g. the
    // pre-rebuild state) is a handled mic failure, never a silent death
    // (finding 1, round 3): the button shows the failed copy.
    void runRecorderBegin({ recorder, onSendVoice, onCancelReply, replyTo, waveformFor })
      .then((result) => {
        if (!result.started) {
          setError(result.error);
          return;
        }
        recordingRef.current = true;
        setRecording(true);
        setElapsedMs(0);
        levelsRef.current = [];
        levelTimerRef.current = setInterval(() => {
          levelsRef.current.push(recorder.currentLevel());
        }, LEVEL_TICK_MS);
        timerRef.current = setInterval(() => {
          const elapsed = recorder.currentDurationMs();
          setElapsedMs(elapsed);
          // The 5-minute cap stops the recording automatically, like the
          // server's `VOICE_MAX_DURATION_MS` refusal would.
          if (elapsed >= VOICE_MAX_DURATION_MS) {
            void finish(false);
          }
        }, TIMER_TICK_MS);
        if (!heldRef.current) {
          void finish(cancelRef.current);
        }
      })
      .catch(() => {
        setError(MIC_FAILED_MESSAGE);
      })
      .finally(() => {
        startingRef.current = false;
      });
  };

  const finish = async (cancel: boolean): Promise<void> => {
    stopTimer();
    recordingRef.current = false;
    setRecording(false);
    setWillCancel(false);
    const levels = levelsRef.current;
    const copy = await runRecorderFinish(
      {
        recorder,
        onSendVoice,
        onCancelReply,
        replyTo,
        waveformFor: waveformFor ?? ((durationMs) => waveformFromLevels(levels, durationMs)),
      },
      cancel,
    );
    if (copy !== undefined) {
      setError(copy);
    }
  };

  const release = (cancel: boolean) => {
    heldRef.current = false;
    cancelRef.current = cancel;
    if (recordingRef.current) {
      void finish(cancel);
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
            <Text
              numberOfLines={1}
              className={
                willCancel
                  ? 'min-w-0 flex-1 text-center text-[13px] text-danger'
                  : 'min-w-0 flex-1 text-center text-[13px] text-muted-foreground'
              }
            >
              {willCancel ? 'Release to cancel' : '‹ Slide to cancel'}
            </Text>
            <Trash2 size={18} color={willCancel ? '#f87171' : ICON[scheme]} />
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
          <Mic size={20} color={recording ? ACCENT_FOREGROUND : ICON[scheme]} />
        </View>
      </View>
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
