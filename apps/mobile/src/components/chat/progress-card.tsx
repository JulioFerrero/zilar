import type { Progress, ProgressStep } from '@zilar/protocol';
import { Effect, Schedule } from 'effect';
import { AsyncResult } from 'effect/reactivity';
import { Check, ChevronRight, Circle, CircleAlert, Square, X } from 'lucide-react-native';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, View } from 'react-native';
import { useReducedMotion } from 'react-native-reanimated';

import { useAisApi } from '@/components/ais/use-ais-api';
import { StepsSheet } from '@/components/chat/steps-sheet';
import { Text } from '@/components/ui/text';
import { ACCENT, DANGER, MUTED_FOREGROUND } from '@/lib/colors';
import { interruptFiber } from '@/lib/effect/timers';
import { useQuery } from '@/lib/effect/use-query';
import { useChatStore } from '@/store/chat-store-provider';

/** Elapsed as `12s`, `2m 14s` or `1h 05m`. */
function formatElapsed(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  if (totalSeconds < 60) {
    return `${totalSeconds}s`;
  }
  const minutes = Math.floor(totalSeconds / 60);
  if (minutes < 60) {
    return `${minutes}m ${totalSeconds % 60}s`;
  }
  return `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, '0')}m`;
}

/** A card without a terminal state is still working. */
function isLive(state: Progress['state']): boolean {
  return state === undefined || state === 'working';
}

/**
 * The elapsed to show: the time from `started_at` to now while working, so it
 * ticks; the frozen `elapsed_ms` once the task is over.
 */
function elapsedFor(progress: Progress, now: number): number | undefined {
  const parsed = progress.started_at === undefined ? undefined : Date.parse(progress.started_at);
  const started = parsed !== undefined && !Number.isNaN(parsed) ? parsed : undefined;
  if (isLive(progress.state)) {
    if (started !== undefined) {
      return Math.max(0, now - started);
    }
    return progress.elapsed_ms;
  }
  if (progress.elapsed_ms !== undefined) {
    return progress.elapsed_ms;
  }
  return started === undefined ? undefined : Math.max(0, now - started);
}

/** The state icon of the collapsed line. */
function StateIcon({ state, reduceMotion }: { state: Progress['state']; reduceMotion: boolean }) {
  if (state === 'done') {
    return <Check size={16} color={ACCENT} aria-hidden />;
  }
  if (state === 'failed') {
    return <CircleAlert size={16} color={DANGER} aria-hidden />;
  }
  if (state === 'stopped') {
    return <Square size={16} color={MUTED_FOREGROUND} aria-hidden />;
  }
  return <ActivityIndicator size="small" color={ACCENT} animating={!reduceMotion} />;
}

/** The state icon of one checklist row. */
function StepIcon({
  state,
  reduceMotion,
}: {
  state: ProgressStep['state'];
  reduceMotion: boolean;
}) {
  if (state === 'done') {
    return <Check size={14} color={ACCENT} aria-hidden />;
  }
  if (state === 'failed') {
    return <X size={14} color={DANGER} aria-hidden />;
  }
  if (state === 'doing') {
    return <ActivityIndicator size="small" color={ACCENT} animating={!reduceMotion} />;
  }
  return <Circle size={14} color={MUTED_FOREGROUND} aria-hidden />;
}

/**
 * The task card: one collapsed line (state icon, title, elapsed) that expands
 * to the step checklist and the summary. Without `steps` it falls back to the
 * old `stage`/`detail` shape, so an old server still renders (T-1419).
 */
export function ProgressCard({ data }: { data: Progress }) {
  const reduceMotion = useReducedMotion();
  const [expanded, setExpanded] = useState(false);
  const [stepsOpen, setStepsOpen] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const ticking = isLive(data.state) && data.started_at !== undefined;

  useEffect(() => {
    if (!ticking) {
      return;
    }
    // A ticking `now` as an Effect fiber per repo rule, no `setInterval`.
    const tick = Effect.sync(() => setNow(Date.now()));
    const timer = Effect.runFork(
      Effect.repeat(tick, Schedule.spaced(1000)).pipe(Effect.delay(1000), Effect.asVoid),
    );
    return () => {
      interruptFiber(timer);
    };
  }, [ticking]);

  const elapsed = elapsedFor(data, now);
  const steps = data.steps ?? [];
  const expandable = steps.length > 0;
  const taskId = data.task_id;

  // T-1422: the Stop button shows only for a working card the viewer can stop:
  // the server set `can_stop`, and the AI belongs to the viewer (its JID is in
  // the viewer's own AI list). The chat id is the open chat's.
  const { api } = useAisApi();
  const chatJid = useChatStore((state) => state.activeChatId);
  const [ownedResult] = useQuery(() => Effect.promise(() => api.listAis()), [api, data.ai]);
  const ownedAi = AsyncResult.isSuccess(ownedResult)
    ? (ownedResult.value.find((ai) => ai.jid === data.ai) ?? null)
    : null;
  const stoppable = isLive(data.state) && data.can_stop === true && ownedAi !== null;
  // The card the stop was tapped on: "Stopping…" lasts until the next edit.
  const [stoppedFor, setStoppedFor] = useState<Progress | null>(null);
  const stopping = stoppedFor === data;
  const stop = (): void => {
    if (ownedAi === null || chatJid === null || stopping) {
      return;
    }
    setStoppedFor(data);
    void api.stopAiTurn(ownedAi.id, chatJid).catch(() => {
      // The card's next edit never came; let the owner try again.
      setStoppedFor(null);
    });
  };

  const header = (
    <>
      <StateIcon state={data.state} reduceMotion={reduceMotion} />
      <Text numberOfLines={1} className="min-w-0 flex-1 text-[15px] font-semibold text-foreground">
        {data.title ?? data.stage}
      </Text>
      {elapsed === undefined ? null : (
        <Text className="shrink-0 font-mono text-[12px] text-muted-foreground">
          {formatElapsed(elapsed)}
        </Text>
      )}
    </>
  );

  return (
    <View className="min-w-[220px] gap-1.5 py-0.5">
      {/* T-1422: the Stop button sits at the right of the collapsed line; the
          expand control and the button are siblings. */}
      <View className="flex-row items-center gap-2">
        {expandable ? (
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ expanded }}
            onPress={() => setExpanded((open) => !open)}
            className="min-w-0 flex-1 flex-row items-center gap-2"
          >
            {header}
          </Pressable>
        ) : (
          <View className="min-w-0 flex-1 flex-row items-center gap-2">{header}</View>
        )}
        {stoppable ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={stopping ? 'Stopping' : 'Stop task'}
            disabled={stopping}
            onPress={stop}
            className="shrink-0 flex-row items-center gap-1 rounded-full px-2 py-0.5"
          >
            <Square size={14} color={MUTED_FOREGROUND} aria-hidden />
            <Text className="text-[12px] font-medium text-muted-foreground">
              {stopping ? 'Stopping…' : 'Stop'}
            </Text>
          </Pressable>
        ) : null}
      </View>

      {expandable ? (
        expanded ? (
          <View className="gap-1.5">
            {steps.map((step) => (
              <View key={step.id} className="flex-row items-center gap-2">
                <StepIcon state={step.state} reduceMotion={reduceMotion} />
                <Text className="min-w-0 flex-1 text-[14px] text-foreground">{step.label}</Text>
              </View>
            ))}
            {data.summary ? (
              <Text className="text-[13px] leading-4 text-muted-foreground">{data.summary}</Text>
            ) : null}
          </View>
        ) : null
      ) : (
        <>
          {data.title ? (
            <Text className="text-[14px] text-muted-foreground">{data.stage}</Text>
          ) : null}
          {data.detail ? (
            <Text className="text-[13px] leading-4 text-muted-foreground">{data.detail}</Text>
          ) : null}
        </>
      )}

      {/* T-1562: a finished card of the viewer's own AI opens the full steps. */}
      {taskId !== undefined && !isLive(data.state) && ownedAi !== null ? (
        <>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="View steps"
            onPress={() => setStepsOpen(true)}
            className="flex-row items-center gap-1.5 border-t border-divider pt-2"
          >
            <Text className="min-w-0 flex-1 text-[13px] font-medium text-foreground">
              View steps
            </Text>
            <ChevronRight size={14} color={MUTED_FOREGROUND} aria-hidden />
          </Pressable>
          <StepsSheet
            visible={stepsOpen}
            onClose={() => setStepsOpen(false)}
            taskId={taskId}
            card={data}
            aiName={ownedAi.name}
            aiAvatarUrl={ownedAi.avatarUrl}
          />
        </>
      ) : null}
    </View>
  );
}
