// effect-plain: hidden dev-only Whistle spike screen (T-0177), unlinked; its async is local UI state, not product flow
/**
 * Hidden Whistle spike screen (T-0177): reachable only by the `zilar://dev/whistle`
 * URL, linked from nowhere. It exists in release builds too (Julio tests a
 * release build) but stays unlinked: no tab, no button, no router push.
 */
import { AudioLines, Download, Mic, Play } from 'lucide-react-native';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { RequireAuth } from '@/auth/RequireAuth';
import { Button } from '@/components/ui/button';
import { Text } from '@/components/ui/text';
import { ACCENT } from '@/lib/colors';
import { createVoiceRecorder } from '@/lib/voice-native';
import { lastVoiceNoteOf } from '@/lib/whistle-last-note';
import { createWhistlePort, type WhistlePort, type WhistleStatus } from '@/lib/whistle-port';
import type { WhistleTranscript } from '@/lib/whistle-port-types';
import { useChatStore } from '@/store/chat-store-provider';
import { useColorScheme } from 'nativewind';

type Phase =
  | { kind: 'idle' }
  | { kind: 'downloading'; fraction: number }
  | { kind: 'loading-model' }
  | { kind: 'recording' }
  | { kind: 'transcribing'; label: string }
  | { kind: 'error'; message: string };

/** Long on purpose: the spike needs a clip that forces several 28 s chunks. */
const RECORD_MS = 120_000;

export interface WhistleScreenDeps {
  port?: WhistlePort | undefined;
}

export default function WhistleDevScreen() {
  return (
    <RequireAuth>
      <WhistleDevScreenBody />
    </RequireAuth>
  );
}

export function WhistleDevScreenBody(deps: WhistleScreenDeps = {}) {
  const scheme = useColorScheme().colorScheme === 'light' ? 'light' : 'dark';
  const port = useRef(deps.port ?? createWhistlePort()).current;
  const [status, setStatus] = useState<WhistleStatus>('missing');
  const [available, setAvailable] = useState(false);
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' });
  const [result, setResult] = useState<WhistleTranscript | undefined>(undefined);
  const messagesByChat = useChatStore((state) => state.messagesByChat);
  // Derived during render, not in an effect: the store snapshot already
  // holds the newest voice note, and there is no external system to sync.
  const lastNote = lastVoiceNoteOf(messagesByChat);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const refresh = useCallback(async () => {
    setAvailable(port.isAvailable());
    try {
      setStatus(await port.modelStatus());
    } catch {
      if (mounted.current) {
        setStatus('missing');
      }
    }
  }, [port]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const fail = useCallback((error: unknown) => {
    const message = error instanceof Error ? error.message : 'Something failed, try again.';
    if (mounted.current) {
      setPhase({ kind: 'error', message });
    }
  }, []);

  const download = useCallback(async () => {
    setResult(undefined);
    setPhase({ kind: 'downloading', fraction: 0 });
    try {
      await port.downloadModel((fraction) => {
        if (mounted.current) {
          setPhase({ kind: 'downloading', fraction });
        }
      });
      if (!mounted.current) {
        return;
      }
      setPhase({ kind: 'loading-model' });
      await port.loadModel();
      if (!mounted.current) {
        return;
      }
      await refresh();
      setPhase({ kind: 'idle' });
    } catch (error) {
      fail(error);
    }
  }, [fail, port, refresh]);

  const transcribeUri = useCallback(
    async (uri: string, label: string, language?: string, audioMs?: number) => {
      setResult(undefined);
      setPhase({ kind: 'transcribing', label });
      const started = Date.now();
      try {
        await port.loadModel().catch(() => {});
        const transcript = await port.transcribe(uri, { language, audioMs });
        if (!mounted.current) {
          return;
        }
        setResult({ ...transcript, wallMs: Math.max(transcript.wallMs, Date.now() - started) });
        setPhase({ kind: 'idle' });
      } catch (error) {
        fail(error);
      }
    },
    [fail, port],
  );

  const recordFiveSeconds = useCallback(async () => {
    setResult(undefined);
    setPhase({ kind: 'recording' });
    try {
      const recorder = createVoiceRecorder();
      const start = await recorder.start();
      if (start.status === 'error') {
        fail(new Error(start.message));
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, RECORD_MS));
      const stop = await recorder.stop();
      if (!mounted.current) {
        return;
      }
      if (stop.status !== 'recorded') {
        fail(
          new Error(stop.status === 'cancelled' ? 'The recording was cancelled.' : stop.message),
        );
        return;
      }
      await transcribeUri(
        stop.recording.uri,
        'Transcribing the recording…',
        undefined,
        stop.recording.durationMs,
      );
    } catch (error) {
      fail(error);
    }
  }, [fail, transcribeUri]);

  const transcribeLast = useCallback(async () => {
    if (lastNote === undefined) {
      fail(new Error('No voice note in any chat yet.'));
      return;
    }
    await transcribeUri(
      lastNote.uri,
      'Transcribing the last voice note…',
      undefined,
      lastNote.durationMs,
    );
  }, [fail, lastNote, transcribeUri]);

  const busy = phase.kind !== 'idle' && phase.kind !== 'error';

  return (
    <SafeAreaView className="flex-1 bg-background">
      <ScrollView
        className="flex-1 px-5 pt-6"
        contentContainerStyle={{ paddingBottom: 48 }}
        testID="whistle-dev-screen"
      >
        <Text variant="h3">Whistle on-device spike</Text>
        <Text className="mt-1 text-[13px] text-muted-foreground">
          {available
            ? `Engine available, model ${status}.`
            : 'Not available on this device (needs Android arm64).'}
        </Text>

        <View className="mt-5 gap-3">
          <Button
            onPress={() => void download()}
            disabled={busy || !available}
            testID="whistle-download"
          >
            <Download size={16} color={ACCENT[scheme]} />
            <Text>Download model</Text>
          </Button>
          {phase.kind === 'downloading' ? (
            <View testID="whistle-progress">
              <View className="h-2 overflow-hidden rounded-full bg-surface-raised">
                <View
                  className="h-2 rounded-full bg-primary"
                  style={{ width: `${Math.round(phase.fraction * 100)}%` }}
                />
              </View>
              <Text className="mt-1 text-[12px] text-muted-foreground">
                {Math.round(phase.fraction * 100)}%
              </Text>
            </View>
          ) : null}
          <Button
            onPress={() => void recordFiveSeconds()}
            disabled={busy || !available || status !== 'ready'}
            testID="whistle-record"
          >
            <Mic size={16} color={ACCENT[scheme]} />
            <Text>Record 2 min and transcribe</Text>
          </Button>
          <Button
            onPress={() => void transcribeLast()}
            disabled={busy || !available || status !== 'ready' || lastNote === undefined}
            testID="whistle-last"
          >
            <Play size={16} color={ACCENT[scheme]} />
            <Text>
              {lastNote === undefined
                ? 'Transcribe last voice note (none yet)'
                : `Transcribe last voice note (${formatMs(lastNote.durationMs)})`}
            </Text>
          </Button>
        </View>

        {phase.kind === 'recording' ||
        phase.kind === 'transcribing' ||
        phase.kind === 'loading-model' ? (
          <View className="mt-5 flex-row items-center gap-2" testID="whistle-busy">
            <ActivityIndicator color={ACCENT[scheme]} />
            <Text className="text-[13px] text-muted-foreground">
              {phase.kind === 'recording'
                ? 'Recording 2 min…'
                : phase.kind === 'loading-model'
                  ? 'Loading the model…'
                  : phase.label}
            </Text>
          </View>
        ) : null}

        {phase.kind === 'error' ? (
          <Text className="mt-5 text-[13px] text-danger" testID="whistle-error">
            {phase.message}
          </Text>
        ) : null}

        {result !== undefined ? (
          <View
            className="mt-5 rounded-xl border border-border-strong bg-surface p-4"
            testID="whistle-result"
          >
            <View className="flex-row items-center gap-2">
              <AudioLines size={16} color={ACCENT[scheme]} />
              <Text className="text-[13px] font-semibold">
                {result.language === '' ? 'Language not detected' : `Language ${result.language}`}
              </Text>
            </View>
            <Text className="mt-2 text-[15px] leading-6">
              {result.text === '' ? '(silence: no speech detected)' : result.text}
            </Text>
            <Text className="mt-3 text-[12px] text-muted-foreground">
              {`Audio ${formatMs(result.audioMs)} · wall ${(result.wallMs / 1000).toFixed(1)} s · ` +
                `first token ${Math.round(result.ttftMs)} ms · ${result.decodeTps.toFixed(1)} tok/s`}
            </Text>
          </View>
        ) : null}

        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Refresh model status"
          onPress={() => void refresh()}
          className="mt-6 self-start rounded px-1 py-0.5"
        >
          <Text className="text-[12px] text-muted-foreground">Refresh status</Text>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}

export function formatMs(value: number): string {
  const totalSeconds = Math.max(0, Math.round(value / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}
