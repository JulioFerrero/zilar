import type { FormBlock as FormBlockData } from '@zilar/protocol';
import { Calendar, Minus, Plus } from 'lucide-react-native';
import { useState } from 'react';
import { Pressable, TextInput, View } from 'react-native';

import { KEY_DARK, KEY_LIGHT, WELL, useBlockRespond } from '@/components/chat/blocks/block-respond';
import { Text } from '@/components/ui/text';
import { cn } from '@/lib/utils';

type Field = FormBlockData['fields'][number];

/** The server accepts at most 120 characters per answer. */
const VALUE_MAX = 120;

function initialValues(fields: readonly Field[]): Record<string, string> {
  return Object.fromEntries(fields.map((field) => [field.id, field.value ?? '']));
}

function numberValue(text: string | undefined): number {
  const parsed = Number.parseInt(text ?? '0', 10);
  return Number.isFinite(parsed) ? parsed : 0;
}

/**
 * 16 · QUICK FORM (T-1796): an optional header, the fields in the board's
 * wells (text and date as inputs, number as −/+ keys around a centered mono
 * value), and the light submit key. Values stop at 120 characters; pressing
 * submit sends the fields and the regular @AI reply with `Label: value` pairs.
 */
export function FormBlock({ block }: { block: FormBlockData }) {
  const respond = useBlockRespond();
  const [values, setValues] = useState<Record<string, string>>(() => initialValues(block.fields));
  const [failed, setFailed] = useState(false);
  // A room correction's values win; adjust during render rather than in an
  // effect, as `use-chat-screen.ts:131` does.
  const [valuesFrom, setValuesFrom] = useState(block);
  if (valuesFrom !== block) {
    setValuesFrom(block);
    setValues(initialValues(block.fields));
    setFailed(false);
  }
  const disabled = respond === null || respond.pending;

  const setValue = (id: string, text: string): void => {
    setValues((previous) => ({ ...previous, [id]: text.slice(0, VALUE_MAX) }));
    setFailed(false);
  };

  const step = (field: Field, delta: number): void => {
    setValue(field.id, String(Math.max(0, numberValue(values[field.id]) + delta)));
  };

  const submit = (): void => {
    if (respond === null || respond.pending) {
      return;
    }
    const reply = block.fields
      .map((field) => `${field.label}: ${values[field.id] ?? ''}`)
      .join(', ');
    setFailed(false);
    respond.submit({
      blockId: block.id,
      value: { fields: values },
      reply,
      onSettled: (ok) => {
        if (!ok) {
          setFailed(true);
        }
      },
    });
  };

  const submitKey = (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={block.submit}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={submit}
      className="h-10 items-center justify-center rounded-[12px] px-4 active:opacity-90"
      style={KEY_LIGHT}
    >
      <Text className="text-[15px] font-medium text-[#0a0a0a]">{block.submit}</Text>
    </Pressable>
  );

  const last = block.fields[block.fields.length - 1];

  return (
    <View className="gap-2">
      {block.title === undefined ? null : (
        <View className="min-h-6 flex-row items-center gap-2">
          <Calendar size={16} color="#a1a1a1" aria-hidden />
          <Text className="flex-1 text-[14px] font-medium text-[#a1a1a1]" numberOfLines={1}>
            {block.title}
          </Text>
        </View>
      )}
      <View className="flex-row flex-wrap gap-2">
        {block.fields.map((field) => {
          if (field.kind === 'number') {
            return (
              <View key={field.id} className="w-full gap-1">
                <Text className="text-[13px] text-[#a1a1a1]">{field.label}</Text>
                <View className="flex-row items-center gap-1.5">
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`${field.label}, less`}
                    accessibilityState={{ disabled }}
                    disabled={disabled}
                    onPress={() => step(field, -1)}
                    className="h-10 w-10 items-center justify-center rounded-[12px] active:opacity-90"
                    style={KEY_DARK}
                  >
                    <Minus size={16} color="#d4d4d4" aria-hidden />
                  </Pressable>
                  <Text className="w-9 text-center font-mono text-[16px]">
                    {values[field.id] ?? '0'}
                  </Text>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`${field.label}, more`}
                    accessibilityState={{ disabled }}
                    disabled={disabled}
                    onPress={() => step(field, 1)}
                    className="h-10 w-10 items-center justify-center rounded-[12px] active:opacity-90"
                    style={KEY_DARK}
                  >
                    <Plus size={16} color="#d4d4d4" aria-hidden />
                  </Pressable>
                  {last?.id === field.id ? (
                    <>
                      <View className="flex-1" />
                      {submitKey}
                    </>
                  ) : null}
                </View>
              </View>
            );
          }
          return (
            <View key={field.id} className="min-w-[120px] flex-1 gap-1">
              <Text className="text-[13px] text-[#a1a1a1]">{field.label}</Text>
              <TextInput
                accessibilityLabel={field.label}
                editable={!disabled}
                value={values[field.id] ?? ''}
                onChangeText={(text) => setValue(field.id, text)}
                placeholder={field.kind === 'date' ? 'YYYY-MM-DD' : undefined}
                placeholderTextColor="#5a5a5a"
                className={cn(
                  'h-10 rounded-[12px] px-3 font-mono text-[14px] text-[#ededed]',
                  disabled && 'opacity-60',
                )}
                style={WELL}
              />
            </View>
          );
        })}
      </View>
      {last?.kind === 'number' ? null : <View className="flex-row justify-end">{submitKey}</View>}
      {failed ? (
        <Text className="text-[13px] font-semibold text-danger">Could not send. Try again.</Text>
      ) : null}
    </View>
  );
}
