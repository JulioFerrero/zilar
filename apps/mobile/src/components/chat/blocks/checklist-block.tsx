import { checklistCount } from '@zilar/chat-core';
import type { ChecklistBlock as ChecklistBlockData } from '@zilar/protocol';
import { Check, ListChecks } from 'lucide-react-native';
import { useState } from 'react';
import { Pressable, View } from 'react-native';
import type { TextStyle, ViewStyle } from 'react-native';

import { useBlockRespond } from '@/components/chat/blocks/block-respond';
import { TABULAR } from '@/components/chat/blocks/figure-block';
import { Text } from '@/components/ui/text';
import { cn } from '@/lib/utils';

type Item = ChecklistBlockData['items'][number];

// A ticked box is the light key from the board; an unticked one is the recessed
// well.
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
 * 08 · CHECKLIST (T-1756, interactive in T-1796): the board's ticks and labels
 * plus the `done of total` fraction. Each item is a checkbox that sends its new
 * `done` for the message's card; the tick shows at once and the route's merged
 * card leads afterwards. Read-only without a respond context.
 * `showHeading` hides the block's own title row when the card already draws a
 * header, as the "Morning briefing" board does.
 */
export function ChecklistBlock({
  block,
  showHeading,
}: {
  block: ChecklistBlockData;
  showHeading: boolean;
}) {
  const respond = useBlockRespond();
  const [overrides, setOverrides] = useState<Record<string, boolean>>({});
  const items = block.items.map((item) => ({
    ...item,
    done: overrides[item.id] ?? item.done,
  }));
  const { done, total } = checklistCount({ ...block, items });

  const toggle = (item: Item): void => {
    if (respond === null || respond.pending) {
      return;
    }
    const next = !(overrides[item.id] ?? item.done);
    setOverrides((previous) => ({ ...previous, [item.id]: next }));
    respond.submit({
      blockId: block.id,
      itemId: item.id,
      value: { done: next },
      onSettled: () => {
        // The route's data (or the unchanged prop on failure) is the truth now.
        setOverrides((previous) => {
          const rest = { ...previous };
          delete rest[item.id];
          return rest;
        });
      },
    });
  };

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
      {items.map((item) => (
        <Pressable
          key={item.id}
          accessibilityRole="checkbox"
          accessibilityLabel={`${item.label}, ${item.done ? 'done' : 'not done'}${
            item.by === undefined ? '' : `, ${item.by}`
          }`}
          accessibilityState={{ checked: item.done, disabled: respond === null }}
          disabled={respond === null || respond.pending}
          onPress={() => toggle(item)}
          className={cn(
            'min-h-[44px] flex-row items-center gap-3',
            respond === null ? undefined : 'active:opacity-80',
          )}
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
        </Pressable>
      ))}
    </View>
  );
}
