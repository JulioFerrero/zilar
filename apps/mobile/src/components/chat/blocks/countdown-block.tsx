import { countdownParts } from '@zilar/chat-core';
import type { CountdownBlock as CountdownBlockData } from '@zilar/protocol';
import { Effect, Schedule } from 'effect';
import { Clock } from 'lucide-react-native';
import { useEffect, useState } from 'react';
import { View } from 'react-native';
import type { ViewStyle } from 'react-native';

import { TABULAR } from '@/components/chat/blocks/figure-block';
import { Text } from '@/components/ui/text';
import { interruptFiber } from '@/lib/effect/timers';

// The board's recessed tile (`PhoneProgress.dc.html:36`): the D24 well recipe at
// the board's 12 px radius and 8 px vertical padding.
const TILE: ViewStyle = {
  boxShadow: 'inset 0 2px 6px rgba(0,0,0,.9), 0 1px 0 rgba(255,255,255,.06)',
};

// The board prints each tile two digits wide ("02 hours · 14 min · 09 sec").
function pad(value: number): string {
  return String(value).padStart(2, '0');
}

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
export function CountdownBlock({
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
