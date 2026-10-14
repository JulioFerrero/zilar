import type { Progress, ProgressStep } from '@zilar/protocol';
import { Effect, Schedule } from 'effect';
import { Check, Circle, CircleAlert, Square, X } from 'lucide-react-native';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, View } from 'react-native';
import { useReducedMotion } from 'react-native-reanimated';

import { Text } from '@/components/ui/text';
import { ACCENT, DANGER, MUTED_FOREGROUND } from '@/lib/colors';
import { interruptFiber } from '@/lib/effect/timers';

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
      {expandable ? (
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ expanded }}
          onPress={() => setExpanded((open) => !open)}
          className="flex-row items-center gap-2"
        >
          {header}
        </Pressable>
      ) : (
        <View className="flex-row items-center gap-2">{header}</View>
      )}

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
    </View>
  );
}
