import { formatClock } from '@zilar/chat-core';
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

/** A card without a terminal state is still working. */
function isLive(state: Progress['state']): boolean {
  return state === undefined || state === 'working';
}

// The elapsed time: from `started_at` to now while working, so it ticks; the frozen `elapsed_ms` once over.
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

// The task card: one collapsed line that expands to the step checklist and summary. Without `steps` it falls back to the old `stage`/`detail` shape, so an old server still renders.
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

  const live = isLive(data.state);
  const elapsed = elapsedFor(data, now);
  const steps = data.steps ?? [];
  const expandable = steps.length > 0;
  const taskId = data.task_id;

  // Stop shows only for a working card the viewer can stop: the server set `can_stop` and the AI belongs to the viewer.
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
      <Text numberOfLines={2} className="min-w-0 shrink text-[15px] font-semibold text-foreground">
        {data.title ?? data.stage}
      </Text>
      {/* A `flex-1` spacer (basis 0) pushes the timer and the key to the right
          without shrinking the title, which now sizes by its full text width. */}
      <View className="flex-1" />
      {elapsed === undefined ? null : (
        <Text className="shrink-0 font-mono text-[12px] text-muted-foreground">
          {formatClock(elapsed)}
        </Text>
      )}
    </>
  );

  const stopKey = stoppable ? (
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
  ) : null;

  const stepList = (
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
  );

  // A finished card is one pressable line: state icon, full title, duration and chevron. A press opens the full steps for the viewer's own AI, and expands them otherwise.
  const ownedTask = ownedAi !== null && taskId !== undefined ? { taskId, ai: ownedAi } : undefined;
  if (!live) {
    const pressable = ownedTask !== undefined || expandable;
    return (
      <View className="self-stretch gap-1.5 py-0.5">
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ expanded }}
          accessibilityLabel={ownedTask === undefined ? 'Show steps' : 'View steps'}
          disabled={!pressable}
          onPress={() => {
            if (ownedTask === undefined) {
              setExpanded((open) => !open);
            } else {
              setStepsOpen(true);
            }
          }}
          className="flex-row items-center gap-2"
        >
          {header}
          {pressable ? <ChevronRight size={16} color={MUTED_FOREGROUND} aria-hidden /> : null}
        </Pressable>
        {expandable && expanded ? stepList : null}
        {ownedTask === undefined ? null : (
          <StepsSheet
            visible={stepsOpen}
            onClose={() => setStepsOpen(false)}
            taskId={ownedTask.taskId}
            card={data}
            aiName={ownedTask.ai.name}
            aiAvatarUrl={ownedTask.ai.avatarUrl}
          />
        )}
      </View>
    );
  }

  return (
    <View className="self-stretch gap-1.5 py-0.5">
      <View className="flex-row items-center gap-2">
        {header}
        {stopKey}
      </View>

      {expandable ? (
        stepList
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
    </View>
  );
}
