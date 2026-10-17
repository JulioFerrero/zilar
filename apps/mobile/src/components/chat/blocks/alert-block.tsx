import type { AlertBlock as AlertBlockData } from '@zilar/protocol';
import { Bell } from 'lucide-react-native';
import { useRef, useState } from 'react';
import { Pressable, TextInput, View } from 'react-native';

import { KEY_DARK, WELL, useBlockRespond } from '@/components/chat/blocks/block-respond';
import { Text } from '@/components/ui/text';
import { cn } from '@/lib/utils';

/** The server accepts at most 120 characters per answer. */
const VALUE_MAX = 120;

const SWITCH_ON = {
  experimental_backgroundImage: 'linear-gradient(180deg, #ffffff, #d4d4d4)',
  boxShadow: 'inset 0 1px 0 #fff, 0 1px 2px rgba(0,0,0,.8)',
} as const;

const KNOB_ON = {
  experimental_backgroundImage: 'linear-gradient(180deg, #2c2c2c, #151515)',
  boxShadow: 'inset 0 1px 0 rgba(255,255,255,.16), 0 1px 2px rgba(0,0,0,.8)',
} as const;

/**
 * 18 · ALERT RULE (T-1850): a bell and the title, then the value well and a
 * 50×30 switch, then the note. The answer is not a decision: the switch sends
 * `done` and the well sends `fields.value`, both without an @AI reply.
 */
export function AlertBlock({ block }: { block: AlertBlockData }) {
  const respond = useBlockRespond();
  const [on, setOn] = useState(block.on);
  const [value, setValue] = useState(block.field.value);
  // The text this edit already sent, so the two commit events of one edit
  // (submit and end) send once.
  const sent = useRef<string | null>(null);
  // A room correction replaces both the switch and the value; adjust during
  // render rather than in an effect, as `rating-block.tsx` does.
  const [from, setFrom] = useState(block);
  if (from !== block) {
    setFrom(block);
    setOn(block.on);
    setValue(block.field.value);
  }
  const disabled = respond === null || respond.pending;

  const commitValue = (): void => {
    if (respond === null || respond.pending) {
      return;
    }
    const next = value.trim();
    if (next === '' || next === block.field.value || next === sent.current) {
      return;
    }
    const previous = block.field.value;
    sent.current = next;
    setValue(next);
    respond.submit({
      blockId: block.id,
      value: { fields: { value: next } },
      onSettled: (ok) => {
        sent.current = null;
        if (!ok) {
          setValue(previous);
        }
      },
    });
  };

  const toggle = (): void => {
    if (respond === null || respond.pending) {
      return;
    }
    const next = !on;
    const previous = on;
    setOn(next);
    respond.submit({
      blockId: block.id,
      value: { done: next },
      onSettled: (ok) => {
        if (!ok) {
          setOn(previous);
        }
      },
    });
  };

  return (
    <View className="gap-2.5">
      <View className="min-h-6 flex-row items-center gap-2">
        <Bell size={16} color="#a1a1a1" aria-hidden />
        <Text className="flex-1 text-[14px] font-medium text-[#a1a1a1]" numberOfLines={2}>
          {block.title}
        </Text>
      </View>
      <View className="flex-row items-center gap-2.5">
        <TextInput
          accessibilityLabel={block.field.label}
          editable={!disabled}
          value={value}
          onChangeText={setValue}
          onSubmitEditing={commitValue}
          onEndEditing={commitValue}
          maxLength={VALUE_MAX}
          className={cn(
            'h-10 flex-1 rounded-[12px] px-3 font-mono text-[14px] text-[#ededed]',
            disabled && 'opacity-60',
          )}
          style={WELL}
        />
        <Pressable
          key={on ? 'on' : 'off'}
          accessibilityRole="switch"
          accessibilityLabel={`${block.title}, ${block.field.label}`}
          accessibilityState={{ checked: on, disabled }}
          disabled={disabled}
          onPress={toggle}
          className="h-[30px] w-[50px] flex-row items-center rounded-full px-[3px]"
          style={[{ justifyContent: on ? 'flex-end' : 'flex-start' }, on ? SWITCH_ON : KEY_DARK]}
        >
          <View
            className="h-6 w-6 rounded-full"
            style={on ? KNOB_ON : { backgroundColor: '#8a8a8a' }}
          />
        </Pressable>
      </View>
      {block.note === undefined ? null : (
        <Text className="text-[13px] text-[#8a8a8a]" numberOfLines={2}>
          {block.note}
        </Text>
      )}
    </View>
  );
}
