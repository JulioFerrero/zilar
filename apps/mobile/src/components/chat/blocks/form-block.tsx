import type { FormBlock as FormBlockData } from '@zilar/protocol';
import { Calendar, Check, Minus, Plus } from 'lucide-react-native';
import { useState } from 'react';
import { Pressable, TextInput, View } from 'react-native';

import { KEY_DARK, KEY_LIGHT, WELL, useBlockRespond } from '@/components/chat/blocks/block-respond';
import { TABULAR } from '@/components/chat/blocks/figure-block';
import { Text } from '@/components/ui/text';
import { cn } from '@/lib/utils';

type Field = FormBlockData['fields'][number];

/** The server accepts at most 120 characters per answer. */
const VALUE_MAX = 120;

type Answer = { at: Date; by?: string | undefined; mine: boolean };

function valueOf(field: Field): string {
  const value = field.value ?? '';
  return field.kind === 'number' && value === '' ? '0' : value;
}

function initialValues(fields: readonly Field[]): Record<string, string> {
  return Object.fromEntries(fields.map((field) => [field.id, valueOf(field)]));
}

/** The sent row the server merged in; `undefined` when the form is open. */
function sentAnswer(block: FormBlockData): Answer | undefined {
  const sent = block.sent;
  if (sent === undefined) {
    return undefined;
  }
  return { at: new Date(sent.at), by: sent.by, mine: false };
}

/** The board's `17:41` answer time: a fixed 24-hour clock. */
function clockTime(date: Date): string {
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

function numberValue(text: string | undefined): number {
  const parsed = Number.parseInt(text ?? '0', 10);
  return Number.isFinite(parsed) ? parsed : 0;
}

/**
 * 16 · QUICK FORM (T-1796): an optional header, the fields in the board's
 * wells (text and date as inputs, number as −/+ keys around a centered mono
 * value that starts at 0), and the light submit key. Values stop at 120
 * characters; pressing submit sends the fields and the regular @AI reply with
 * `Label: value` pairs. A sent form draws its values read-only under the
 * answered row.
 */
export function FormBlock({ block }: { block: FormBlockData }) {
  const respond = useBlockRespond();
  const [values, setValues] = useState<Record<string, string>>(() => initialValues(block.fields));
  const [answered, setAnswered] = useState<Answer | undefined>(() => sentAnswer(block));
  // A room correction's values win; adjust during render rather than in an
  // effect, as `use-chat-screen.ts:131` does. A send made in this view keeps
  // the "You sent this" wording.
  const [valuesFrom, setValuesFrom] = useState(block);
  if (valuesFrom !== block) {
    setValuesFrom(block);
    setValues(initialValues(block.fields));
    const next = sentAnswer(block);
    if (next !== undefined) {
      setAnswered((current) => (current?.mine === true ? current : next));
    }
  }
  const disabled = respond === null || respond.pending || answered !== undefined;

  const setValue = (id: string, text: string): void => {
    setValues((previous) => ({ ...previous, [id]: text.slice(0, VALUE_MAX) }));
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
    respond.submit({
      blockId: block.id,
      value: { fields: values },
      reply,
      onSettled: (ok) => {
        if (ok) {
          setAnswered((current) => current ?? { at: new Date(), mine: true });
        }
      },
    });
  };

  const submitKey = answered === undefined && (
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

  const answeredRow = answered !== undefined && (
    <View className="flex-row items-center gap-2">
      <View className="h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full bg-[#22c55e]">
        <Check size={12} color="#0a0a0a" aria-hidden />
      </View>
      <Text className="flex-1 text-[14px] text-[#a1a1a1]" numberOfLines={2}>
        {answered.mine
          ? 'You sent this'
          : answered.by === undefined
            ? 'Sent'
            : `${answered.by} sent this`}
      </Text>
      <Text className="font-mono text-[12px] text-[#8a8a8a]" style={TABULAR}>
        {clockTime(answered.at)}
      </Text>
    </View>
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
                  {answered === undefined && last?.id === field.id ? (
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
      {last?.kind === 'number' || answered !== undefined ? null : (
        <View className="flex-row justify-end">{submitKey}</View>
      )}
      {answeredRow}
    </View>
  );
}
