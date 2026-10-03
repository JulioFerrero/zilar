import { Mic, Trash2 } from 'lucide-react-native';
import { useEffect, useRef, useState } from 'react';
import { Pressable, View } from 'react-native';

import { IconButton } from '@/components/ui/icon-button';
import { Text } from '@/components/ui/text';
import { asColorScheme, type ColorScheme } from '@/lib/color-scheme';
import { ICON } from '@/lib/colors';
import { VOICE_MAX_DURATION_MS, VOICE_MIN_MS } from '@/lib/voice';
import {
  createVoiceRecorder,
  RECORD_FAILED_MESSAGE,
  RECORD_TOO_LONG_MESSAGE,
  RECORD_TOO_SHORT_MESSAGE,
  type FinishedRecording,
  type VoiceRecorderPort,
} from '@/lib/voice-native';
import type { ReplyRef } from '@/lib/types';
import type { SendTextOptions, SendVoiceRecording } from '@/store/types';
import { useColorScheme } from 'nativewind';

/** How often the recording row re-reads the live duration. */
const TIMER_TICK_MS = 250;

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

function flatWaveform(durationMs: number): number[] {
  const buckets = Math.min(64, Math.max(8, Math.round(durationMs / 1000) * 4));
  return Array.from({ length: buckets }, () => 12);
}

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
    if (recordingRef.current || disabled) {
      return;
    }
    setError(undefined);
    void recorder.start().then((started) => {
      if (started.status === 'error') {
        setError(started.message);
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
    });
  };

  const finish = async (cancel: boolean): Promise<void> => {
    stopTimer();
    recordingRef.current = false;
    setRecording(false);
    if (cancel) {
      await recorder.cancel().catch(() => {});
      return;
    }
    const result = await recorder
      .stop()
      .catch(() => ({ status: 'error' as const, message: RECORD_FAILED_MESSAGE }));
    if (result.status === 'cancelled') {
      return;
    }
    if (result.status === 'error') {
      setError(result.message);
      return;
    }
    const finished: FinishedRecording = result.recording;
    if (finished.durationMs < VOICE_MIN_MS) {
      setError(RECORD_TOO_SHORT_MESSAGE);
      return;
    }
    if (finished.durationMs > VOICE_MAX_DURATION_MS || finished.size > 10 * 1024 * 1024) {
      setError(RECORD_TOO_LONG_MESSAGE);
      return;
    }
    const build = waveformFor ?? flatWaveform;
    onSendVoice(
      {
        uri: finished.uri,
        mimeType: finished.mimeType,
        size: finished.size,
        durationMs: finished.durationMs,
        waveform: build(finished.durationMs),
      },
      replyTo === undefined ? undefined : { replyTo },
    );
    onCancelReply();
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
