import type { TimelineBlock as TimelineBlockData } from '@zilar/protocol';
import { Check, Package } from 'lucide-react-native';
import { View } from 'react-native';

import { TABULAR } from '@/components/chat/blocks/figure-block';
import { Text } from '@/components/ui/text';

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
export function TimelineBlock({
  block,
  showHeading,
}: {
  block: TimelineBlockData;
  showHeading: boolean;
}) {
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
