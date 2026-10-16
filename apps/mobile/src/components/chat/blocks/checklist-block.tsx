import { checklistCount } from '@zilar/chat-core';
import type { ChecklistBlock as ChecklistBlockData } from '@zilar/protocol';
import { Check, ListChecks } from 'lucide-react-native';
import { View } from 'react-native';
import type { TextStyle, ViewStyle } from 'react-native';

import { TABULAR } from '@/components/chat/blocks/figure-block';
import { Text } from '@/components/ui/text';

// A ticked box is the light key from the board; an unticked one is the recessed
// well. Read-only here (T-1756): the boxes are views, never controls.
const BOX_ON: ViewStyle = {
  experimental_backgroundImage: 'linear-gradient(180deg, #ffffff, #d4d4d4)',
  boxShadow: 'inset 0 1px 0 #fff, 0 1px 2px rgba(0,0,0,.8)',
};
const BOX_OFF: ViewStyle = { boxShadow: 'inset 0 1px 2px rgba(0,0,0,.9)' };
// A done label is muted and struck through, as the board draws it.
const DONE_LABEL: TextStyle = { color: '#8a8a8a', textDecorationLine: 'line-through' };

function ItemBox({ done }: { done: boolean }) {
  return (
    <View
      className={
        done
          ? 'h-5 w-5 shrink-0 items-center justify-center rounded-[6px]'
          : 'h-5 w-5 shrink-0 rounded-[6px] border border-[#2a2a2a] bg-[#0c0c0c]'
      }
      style={done ? BOX_ON : BOX_OFF}
    >
      {done ? <Check size={12} color="#0a0a0a" aria-hidden /> : null}
    </View>
  );
}

/**
 * 08 · CHECKLIST, read-only (T-1756): the board's ticks and labels plus the
 * `done of total` fraction. `showHeading` hides the block's own title row when
 * the card already draws a header, as the "Morning briefing" board does.
 */
export function ChecklistBlock({
  block,
  showHeading,
}: {
  block: ChecklistBlockData;
  showHeading: boolean;
}) {
  const { done, total } = checklistCount(block);
  return (
    <View className="gap-1">
      {showHeading ? (
        <View className="min-h-6 flex-row items-center gap-2">
          <ListChecks size={16} color="#a1a1a1" aria-hidden />
          <Text className="flex-1 text-[14px] font-medium text-[#a1a1a1]" numberOfLines={1}>
            {block.title}
          </Text>
          <Text className="font-mono text-[12px] text-[#8a8a8a]" style={TABULAR} numberOfLines={1}>
            {`${done} of ${total}`}
          </Text>
        </View>
      ) : null}
      {block.items.map((item) => (
        <View
          key={item.id}
          accessible
          accessibilityLabel={`${item.label}, ${item.done ? 'done' : 'not done'}${
            item.by === undefined ? '' : `, ${item.by}`
          }`}
          className="min-h-[44px] flex-row items-center gap-3"
        >
          <ItemBox done={item.done} />
          <Text className="flex-1" style={item.done ? DONE_LABEL : undefined} numberOfLines={2}>
            {item.label}
          </Text>
          {item.by === undefined ? null : (
            <Text className="text-[13px] text-[#8a8a8a]" numberOfLines={1}>
              {item.by}
            </Text>
          )}
        </View>
      ))}
    </View>
  );
}
