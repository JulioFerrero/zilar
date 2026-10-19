import type {
  Block,
  ProgressBlock as ProgressBlockData,
  CountdownBlock as CountdownBlockData,
  TimelineBlock as TimelineBlockData,
} from '@zilar/protocol';
import { type ReactNode, useEffect, useState } from 'react';
import { ratioPercent, countdownParts, pad } from '@zilar/chat-core';
import { CloudUpload, Clock, Check, Package } from 'lucide-react-native';
import { View, ViewStyle } from 'react-native';
import { TABULAR } from '@/components/chat/blocks/figure-block';
import { Text } from '@/components/ui/text';
import { Effect, Schedule } from 'effect';
import { interruptFiber } from '@zilar/client-core';

type Step = TimelineBlockData['steps'][number];

// The markers of the three states (`PhoneProgress.dc.html:88,96,100`): a filled
// disc with a dark tick, a ring with an inner dot, and an empty well disc.
function Mark({ state }: { state: Step['state'] }) {
  if (state === 'done') {
    return (
      <View className="h-4 w-4 shrink-0 items-center justify-center rounded-full bg-[#ededed]">
        <Check size={10} color="#0a0a0a" aria-hidden />
      </View>
    );
  }
  if (state === 'current') {
    return (
      <View className="h-4 w-4 shrink-0 items-center justify-center rounded-full border border-[#ededed]">
        <View className="h-1.5 w-1.5 rounded-full bg-[#ededed]" />
      </View>
    );
  }
  return <View className="h-4 w-4 shrink-0 rounded-full border border-[#2a2a2a] bg-[#0c0c0c]" />;
}

/**
 * 10 · TIMELINE: ordered steps, each marked done, current or todo. `showHeading`
 * hides the block's own title row when the card already draws a header.
 */
function TimelineBlock({ block, showHeading }: { block: TimelineBlockData; showHeading: boolean }) {
  return (
    <View className="gap-2.5">
      {showHeading ? (
        <View className="min-h-6 flex-row items-center gap-2">
          <Package size={16} color="#a1a1a1" aria-hidden />
          <Text className="flex-1 text-[14px] font-medium text-[#a1a1a1]" numberOfLines={1}>
            {block.title}
          </Text>
        </View>
      ) : null}
      <View>
        {block.steps.map((step, index) => {
          const last = index === block.steps.length - 1;
          return (
            <View key={`${step.label}-${index}`} className="flex-row gap-3">
              <View className="w-4 shrink-0 items-center">
                <Mark state={step.state} />
                {/* The connector runs to the next step: light after a done
                    step, dark otherwise (the board, `:88` vs `:96`). */}
                {last ? null : (
                  <View
                    className="w-0.5 flex-1"
                    style={{
                      minHeight: 22,
                      backgroundColor: step.state === 'done' ? '#ededed' : '#2a2a2a',
                    }}
                  />
                )}
              </View>
              <View className={last ? 'flex-1 gap-0.5' : 'flex-1 gap-0.5 pb-3'}>
                <View className="flex-row justify-between gap-3">
                  <Text
                    className={
                      step.state === 'current'
                        ? 'flex-1 font-medium'
                        : step.state === 'todo'
                          ? 'flex-1 text-[#8a8a8a]'
                          : 'flex-1'
                    }
                    numberOfLines={1}
                  >
                    {step.label}
                  </Text>
                  {step.at === undefined ? null : (
                    <Text
                      className="shrink-0 font-mono text-[12px] text-[#8a8a8a]"
                      style={TABULAR}
                      numberOfLines={1}
                    >
                      {step.at}
                    </Text>
                  )}
                </View>
                {step.detail === undefined ? null : (
                  <Text className="text-[13px] text-[#a1a1a1]" numberOfLines={2}>
                    {step.detail}
                  </Text>
                )}
              </View>
            </View>
          );
        })}
      </View>
    </View>
  );
}

// The board's recessed tile (`PhoneProgress.dc.html:36`): the D24 well recipe at
// the board's 12 px radius and 8 px vertical padding.
const TILE: ViewStyle = {
  boxShadow: 'inset 0 2px 6px rgba(0,0,0,.9), 0 1px 0 rgba(255,255,255,.06)',
};

// The board prints each tile two digits wide ("02 hours · 14 min · 09 sec").
function Tile({ value, unit }: { value: number; unit: string }) {
  return (
    <View className="flex-1 items-center gap-0.5 rounded-[12px] bg-[#0c0c0c] py-2" style={TILE}>
      <Text className="font-mono text-[28px] leading-[34px] text-center" style={TABULAR}>
        {pad(value)}
      </Text>
      <Text className="text-[12px] text-[#8a8a8a]">{unit}</Text>
    </View>
  );
}

/**
 * 11 · COUNTDOWN: the label and the tiles that tick down to `targetAt`. The
 * `now` ticks once a second only until the target is reached, then the interval
 * stops and a muted "Started" line takes the tiles' place. `showHeading` hides
 * the block's own label row when the card already draws a header.
 */
function CountdownBlock({
  block,
  showHeading,
}: {
  block: CountdownBlockData;
  showHeading: boolean;
}) {
  const [now, setNow] = useState(() => Date.now());
  const parts = countdownParts(block.targetAt, now);
  const ticking = !parts.past;

  useEffect(() => {
    if (!ticking) {
      return;
    }
    // A ticking `now` as an Effect fiber per repo rule, not a bare interval;
    // once the target is reached `ticking` turns false, the cleanup interrupts
    // the fiber and the interval stops.
    const tick = Effect.sync(() => setNow(Date.now()));
    const timer = Effect.runFork(
      Effect.repeat(tick, Schedule.spaced(1000)).pipe(Effect.delay(1000), Effect.asVoid),
    );
    return () => {
      interruptFiber(timer);
    };
  }, [ticking]);

  return (
    <View className="gap-2.5">
      {showHeading ? (
        <View className="min-h-6 flex-row items-center gap-2">
          <Clock size={16} color="#a1a1a1" aria-hidden />
          <Text className="flex-1 text-[14px] font-medium text-[#a1a1a1]" numberOfLines={1}>
            {block.label}
          </Text>
        </View>
      ) : null}
      {parts.past ? (
        // A reached target has no tiles to show: a muted word instead of zeros
        // or negative numbers. "Started" is the closer word — a countdown
        // reaches the moment the awaited thing begins, not the one it ends.
        <Text className="text-[13px] text-[#8a8a8a]">Started</Text>
      ) : (
        <View className="flex-row gap-2">
          {parts.days >= 1 ? <Tile value={parts.days} unit="days" /> : null}
          <Tile value={parts.hours} unit="hours" />
          <Tile value={parts.minutes} unit="min" />
          <Tile value={parts.seconds} unit="sec" />
        </View>
      )}
      {block.note === undefined ? null : (
        <Text className="text-[13px] text-[#a1a1a1]">{block.note}</Text>
      )}
    </View>
  );
}

// The board's recessed track (`PhoneProgress.dc.html:25`) and its raised fill
// (`:26`): the D24 well recipe at the board's 8 px height (`:71`).
const TRACK: ViewStyle = {
  boxShadow: 'inset 0 1px 2px rgba(0,0,0,.9), 0 1px 0 rgba(255,255,255,.05)',
};
const FILL: ViewStyle = {
  experimental_backgroundImage: 'linear-gradient(180deg,#f5f5f5,#b5b5b5)',
};

/**
 * 09 · PROGRESS: one bar with the label, the percent and an optional detail and
 * note. `showHeading` hides the block's own label row when the card already
 * draws a header.
 */
function ProgressBlock({ block, showHeading }: { block: ProgressBlockData; showHeading: boolean }) {
  const percent = ratioPercent(block.ratio);
  const percentValue = Number.parseInt(percent, 10);
  return (
    <View className="gap-2.5">
      {showHeading ? (
        <View className="min-h-6 flex-row items-center gap-2">
          <CloudUpload size={16} color="#a1a1a1" aria-hidden />
          <Text className="flex-1 text-[14px] font-medium text-[#a1a1a1]" numberOfLines={1}>
            {block.label}
          </Text>
          <Text className="font-mono text-[14px] text-[#ededed]" style={TABULAR} numberOfLines={1}>
            {percent}
          </Text>
        </View>
      ) : null}
      <View
        accessible
        accessibilityRole="progressbar"
        accessibilityLabel={block.label}
        accessibilityValue={{ min: 0, max: 100, now: percentValue }}
        className="h-2 overflow-hidden rounded-full bg-[#0c0c0c]"
        style={TRACK}
      >
        <View className="h-full rounded-full" style={[FILL, { width: `${percentValue}%` }]} />
      </View>
      {block.detail === undefined && block.note === undefined ? null : (
        <View className="flex-row justify-between gap-3">
          {block.detail === undefined ? null : (
            <Text
              className="font-mono text-[13px] text-[#8a8a8a]"
              style={TABULAR}
              numberOfLines={1}
            >
              {block.detail}
            </Text>
          )}
          {block.note === undefined ? null : (
            <Text className="flex-1 text-right text-[13px] text-[#8a8a8a]" numberOfLines={1}>
              {block.note}
            </Text>
          )}
        </View>
      )}
    </View>
  );
}

/** The kinds the progress group draws on the phone. */
export const PROGRESS_KINDS: ReadonlySet<Block['kind']> = new Set<Block['kind']>([
  'progress',
  'timeline',
  'countdown',
]);

/**
 * The progress group's one dispatch point: `progress` (09), `timeline` (10) and
 * `countdown` (11). The bodies follow the board
 * `docs/design/mockups/blocks/PhoneProgress.dc.html`; each passes `showHeading`
 * through like the status block does.
 */
export function renderProgressBlock(
  block: Extract<Block, { kind: 'progress' | 'timeline' | 'countdown' }>,
  showHeading: boolean,
): ReactNode {
  switch (block.kind) {
    case 'progress':
      return <ProgressBlock block={block} showHeading={showHeading} />;
    case 'timeline':
      return <TimelineBlock block={block} showHeading={showHeading} />;
    case 'countdown':
      return <CountdownBlock block={block} showHeading={showHeading} />;
  }
}
