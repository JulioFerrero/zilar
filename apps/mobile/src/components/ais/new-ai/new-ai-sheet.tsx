import {
  RotateCcw,
  Shuffle,
  X,
  Cloud,
  Laptop,
  PowerOff,
  Sparkles,
  Pencil,
} from 'lucide-react-native';
import { useRef } from 'react';
import { View, Pressable } from 'react-native';
import { type AiTemplateId, AI_TEMPLATE_OPTIONS } from '@zilar/chat-core';

import { BottomSheet } from '@/components/ui/bottom-sheet';
import { Button } from '@/components/ui/button';
import { IconButton } from '@/components/ui/icon-button';
import { StepTrack, type StepTrackStep } from '@/components/ui/step-track';
import { Text } from '@/components/ui/text';
import { ICON } from '@/lib/colors';
import type { PublicAi } from '@/lib/ais-api';
import { LimitsFields } from '@/components/ais/limits-fields';
import type { ComputerMode } from '@/components/ais/computer-picker';
import { SegmentedControl, type SegmentedOption } from '@/components/ui/segmented-control';
import { SelectSheet } from '@/components/ui/select-sheet';
import { TextField } from '@/components/ui/text-field';
import { iconKey } from '@/lib/depth';

import { KeyStep } from './key-step';
import { OrbCapture, OrbView, type OrbCaptureHandle, OrbImage } from './orb-view';
import { ProviderStep } from './provider-step';
import { useNewAiFlow, type NewAiFlow } from './use-new-ai-flow';

const TEMPLATE_OPTIONS: SegmentedOption[] = AI_TEMPLATE_OPTIONS.filter(
  (option) => option.id !== 'custom',
).map((option) => ({ value: option.id, label: option.label }));

function ModelStep({ flow }: { flow: NewAiFlow }) {
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

const COMPUTER_OPTIONS: SegmentedOption[] = [
  { value: 'off', label: 'Off', icon: PowerOff },
  { value: 'cloud', label: 'Zilar', icon: Cloud },
  { value: 'runner', label: 'Machine', icon: Laptop },
  { value: 'auto', label: 'Auto', icon: Sparkles },
];

function SetupStep({ flow }: { flow: NewAiFlow }) {
  const machineOptions = flow.machines.map((machine) => ({
    value: machine.id,
    label: machine.name,
    ...(machine.online === true ? { dot: 'online' as const } : {}),
  }));
  const needsMachine = flow.computer === 'runner' || flow.computer === 'auto';
  const computerOptions = COMPUTER_OPTIONS.map((option) =>
    option.value === 'cloud' ? { ...option, disabled: !flow.cloud } : option,
  );

  return (
    <View className="gap-5">
      <View className="gap-2">
        <Text className="text-[13px] font-medium text-foreground">Computer</Text>
        <SegmentedControl
          mode="radio"
          tone="choice"
          accessibilityLabel="Computer"
          value={flow.computer}
          options={computerOptions}
          onChange={(value) => flow.setComputer(value as ComputerMode)}
        />
        {needsMachine ? (
          <SelectSheet
            label="Machine"
            value={flow.machineId}
            options={machineOptions}
            onChange={flow.setMachineId}
            placeholder="Select a machine"
          />
        ) : null}
      </View>

      <LimitsFields
        day={flow.day}
        month={flow.month}
        dayError={flow.dayError}
        monthError={flow.monthError}
        onDayChange={flow.setDay}
        onMonthChange={flow.setMonth}
      />
    </View>
  );
}

/**
 * The close key, the grabber and Android back are the only ways out; closing before Create abandons a half-made key check.
 */
export function NewAiSheet({
  visible,
  onClose,
  onCreated,
}: {
  visible: boolean;
  onClose: () => void;
  onCreated: (ai: PublicAi, partialFailure: boolean) => void;
}) {
  const flow = useNewAiFlow({ onCreated });
  const capture = useRef<OrbCaptureHandle>(null);

  const providerLabel =
    flow.keys.providerChoices.find((choice) => choice.id === flow.keys.providerId)?.label ??
    flow.keys.providerId ??
    'Provider';
  const modelName =
    flow.modelOptions.find((option) => option.value === flow.model)?.label ?? flow.model;
  const modelLabel = modelName.startsWith(`${providerLabel} `)
    ? modelName.slice(providerLabel.length + 1)
    : modelName;
  const trackSteps: StepTrackStep[] = [
    {
      value: 'provider',
      label: flow.keys.providerId === null ? 'Provider' : providerLabel,
      done: flow.step !== 'provider',
    },
    { value: 'key', label: 'Key', done: flow.step === 'model' || flow.step === 'setup' },
    {
      value: 'model',
      label: flow.model === '' ? 'Model' : modelLabel,
      done: flow.step === 'setup',
    },
    { value: 'setup', label: 'Setup' },
  ];

  const dismiss = (): void => {
    flow.abandon();
    onClose();
  };

  const primary = (): void => {
    if (flow.step === 'setup') {
      flow.create(capture.current?.capture ?? null);
      return;
    }
    flow.advance();
  };

  return (
    <>
      <OrbCapture ref={capture} params={flow.orbParams} />
      <BottomSheet
        visible={visible}
        onClose={dismiss}
        closeLabel="Close New AI"
        title={flow.orbOpen ? 'Orb' : 'New AI'}
        {...(flow.orbOpen ? { onBack: flow.closeOrb } : {})}
        headerRight={
          flow.orbOpen ? (
            <View className="flex-row gap-2">
              <IconButton label="Shuffle" className="h-9 w-9 rounded-xl" onPress={flow.shuffleOrb}>
                <Shuffle size={16} color={ICON} />
              </IconButton>
              <IconButton label="Reset" className="h-9 w-9 rounded-xl" onPress={flow.resetOrb}>
                <RotateCcw size={16} color={ICON} />
              </IconButton>
            </View>
          ) : (
            <IconButton label="Close" className="h-9 w-9 rounded-xl" onPress={dismiss}>
              <X size={16} color={ICON} />
            </IconButton>
          )
        }
        footer={
          flow.orbOpen ? (
            <View className="flex-row items-center gap-2">
              <Button className="flex-1" onPress={flow.closeOrb}>
                <Text>Done</Text>
              </Button>
            </View>
          ) : (
            <View className="flex-row items-center gap-2">
              {flow.step !== 'provider' ? (
                <Button variant="ghost" disabled={flow.busy} onPress={flow.back}>
                  <Text>Back</Text>
                </Button>
              ) : null}
              <Button className="flex-1" disabled={flow.primaryDisabled} onPress={primary}>
                <Text>{flow.primaryLabel}</Text>
              </Button>
            </View>
          )
        }
      >
        {flow.orbOpen ? (
          <OrbView flow={flow} />
        ) : (
          <View className="gap-4">
            <StepTrack steps={trackSteps} current={flow.step} onStepPress={flow.goToStep} />
            {flow.step === 'provider' ? <ProviderStep keys={flow.keys} /> : null}
            {flow.step === 'key' ? <KeyStep keys={flow.keys} /> : null}
            {flow.step === 'model' ? <ModelStep flow={flow} /> : null}
            {flow.step === 'setup' ? <SetupStep flow={flow} /> : null}
            {flow.error !== '' ? (
              <Text accessibilityRole="alert" className="text-[14px] text-danger">
                {flow.error}
              </Text>
            ) : null}
          </View>
        )}
      </BottomSheet>
    </>
  );
}
