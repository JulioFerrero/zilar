import type { AiTemplateId } from '@zilar/chat-core';
import { Pencil } from 'lucide-react-native';
import { Pressable, View } from 'react-native';

import { AI_TEMPLATE_OPTIONS } from '@zilar/chat-core';
import { SegmentedControl, type SegmentedOption } from '@/components/ui/segmented-control';
import { SelectSheet } from '@/components/ui/select-sheet';
import { Text } from '@/components/ui/text';
import { TextField } from '@/components/ui/text-field';
import { ICON } from '@/lib/colors';
import { iconKey } from '@/lib/depth';

import { OrbImage } from './orb-view';
import type { NewAiFlow } from './use-new-ai-flow';

const TEMPLATE_OPTIONS: SegmentedOption[] = AI_TEMPLATE_OPTIONS.filter(
  (option) => option.id !== 'custom',
).map((option) => ({ value: option.id, label: option.label }));

export function ModelStep({ flow }: { flow: NewAiFlow }) {
  return (
    <View className="gap-5">
      <View className="items-center gap-4">
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Change the orb"
          onPress={flow.openOrb}
          className="active:opacity-80"
        >
          <OrbImage params={flow.orbParams} size={72} />
          <View
            className="absolute -bottom-1 -right-1 h-7 w-7 items-center justify-center rounded-full"
            style={iconKey}
          >
            <Pencil size={13} color={ICON} />
          </View>
        </Pressable>

        <View className="gap-1 self-stretch">
          <Text className="text-[13px] font-medium text-foreground">Name</Text>
          <TextField
            value={flow.name}
            onChangeText={flow.setName}
            accessibilityLabel="Name"
            placeholder="Research helper"
            maxLength={64}
          />
        </View>
      </View>

      <View className="gap-1">
        <Text className="text-[13px] font-medium text-foreground">Model</Text>
        {flow.modelOptions.length === 0 ? (
          <TextField
            value={flow.model}
            onChangeText={flow.setModel}
            accessibilityLabel="Model"
            placeholder="Model id"
            autoCapitalize="none"
            autoCorrect={false}
            maxLength={256}
          />
        ) : (
          <SelectSheet
            label="Model"
            value={flow.model === '' ? null : flow.model}
            options={flow.modelOptions}
            onChange={flow.setModel}
            searchPlaceholder="Filter models"
          />
        )}
      </View>

      <View className="gap-1">
        <Text className="text-[13px] font-medium text-foreground">Template</Text>
        <SegmentedControl
          mode="radio"
          tone="choice"
          accessibilityLabel="Template"
          value={flow.template}
          options={TEMPLATE_OPTIONS}
          onChange={(value) => flow.setTemplate(value as AiTemplateId)}
        />
      </View>
    </View>
  );
}
