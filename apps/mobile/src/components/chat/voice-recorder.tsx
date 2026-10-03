import { Mic, Trash2 } from 'lucide-react-native';
import { useEffect, useRef, useState } from 'react';
import { Pressable, View } from 'react-native';

import { IconButton } from '@/components/ui/icon-button';
import { Text } from '@/components/ui/text';
import { asColorScheme, type ColorScheme } from '@/lib/color-scheme';
import { ICON } from '@/lib/colors';
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
};

/** How often the recording row re-reads the live duration. */
const TIMER_TICK_MS = 250;

/**
 * The composer's mic button (T-0154): tap to record, tap Send to send, trash
 * to cancel. While recording a timer row replaces the input (web's gesture
 * and states, touch-sized): a red dot, the elapsed time, and a 5-minute cap
 * that stops the recording automatically. Under one second is refused with
 * the same plain copy as web's "Recording too short".
 */
export function VoiceRecorderButton({
  onSendVoice,
  replyTo,
  onCancelReply,
  canSend,
  recorder: recorderProp,
  waveformFor,
  disabled = false,
}: VoiceRecorderProps) {
  const scheme: ColorScheme = asColorScheme(useColorScheme().colorScheme);
  const [recorder] = useState<VoiceRecorderPort>(() => recorderProp ?? createVoiceRecorder());
  const [recording, setRecording] = useState(false);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [error, setError] = useState<string | undefined>(undefined);
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
      if (recordingRef.current) {
        recordingRef.current = false;
        void recorder.cancel().catch(() => {});
      }
    },
    [recorder],
  );

  const stopTimer = () => {
    if (timerRef.current !== undefined) {
      clearInterval(timerRef.current);
      timerRef.current = undefined;
    }
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
    void runRecorderBegin({ recorder, onSendVoice, onCancelReply, replyTo, waveformFor })
      .then((result) => {
        if (!result.started) {
          setError(result.error);
          return;
        }
        recordingRef.current = true;
        setRecording(true);
        setElapsedMs(0);
        timerRef.current = setInterval(() => {
          const elapsed = recorder.currentDurationMs();
          setElapsedMs(elapsed);
          // The 5-minute cap stops the recording automatically, like the
          // server's `VOICE_MAX_DURATION_MS` refusal would.
          if (elapsed >= VOICE_MAX_DURATION_MS) {
            void finish(false);
          }
        }, TIMER_TICK_MS);
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
    const copy = await runRecorderFinish(
      { recorder, onSendVoice, onCancelReply, replyTo, waveformFor },
      cancel,
    );
    if (copy !== undefined) {
      setError(copy);
    }
  };

  if (recording) {
    return (
      <View className="flex-1">
        <View className="flex h-9 min-w-0 flex-1 flex-row items-center gap-3 px-1">
          <View className="size-2.5 shrink-0 rounded-full bg-danger" />
          <Text className="shrink-0 font-mono text-[15px] tabular-nums text-foreground">
            {formatElapsed(elapsedMs)}
          </Text>
          <Text
            numberOfLines={1}
            className="min-w-0 flex-1 text-center text-[13px] text-muted-foreground"
          >
            Tap Send to send
          </Text>
          <IconButton
            label="Cancel voice message"
            className="h-9 w-9 rounded-[10px]"
            onPress={() => void finish(true)}
          >
            <Trash2 size={20} color={ICON[scheme]} />
          </IconButton>
          <IconButton
            label="Send voice message"
            className="h-9 w-9 rounded-[10px]"
            onPress={() => void finish(false)}
          >
            <Mic size={20} color={ICON[scheme]} />
          </IconButton>
        </View>
        {error !== undefined ? (
          <Text className="mt-1 px-1 text-[12px] text-danger">{error}</Text>
        ) : null}
      </View>
    );
  }

  if (canSend) {
    return null;
  }

  return (
    <View>
      <IconButton
        label="Record voice message"
        className="h-9 w-9 rounded-[10px]"
        onPress={begin}
        disabled={disabled}
      >
        <Mic size={20} color={ICON[scheme]} />
      </IconButton>
      {error !== undefined ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Dismiss error"
          onPress={() => setError(undefined)}
        >
          <Text className="mt-1 px-1 text-[12px] text-danger">{error}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}
