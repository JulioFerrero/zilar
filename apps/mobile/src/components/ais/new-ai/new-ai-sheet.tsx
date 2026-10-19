// effect-plain: the New AI wizard is plain React state; its async is the shared key-check and create calls over the injected promise APIs.
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
import { forwardRef, useId, useImperativeHandle, useMemo, useRef, useState, type Ref } from 'react';
import { View, Pressable } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Svg, { Circle, Defs, RadialGradient, Stop } from 'react-native-svg';
import { ApiError } from '@zilar/api-contract';
import {
  makeAisApi,
  useNewAiFlowState,
  type NewAiFlowPort,
  type NewAiStep,
  type OrbParams,
} from '@zilar/client-core';
import { ORB_HUES, ORB_RIMS, type AiTemplateId, AI_TEMPLATE_OPTIONS } from '@zilar/chat-core';

import { BottomSheet } from '@/components/ui/bottom-sheet';
import { Button } from '@/components/ui/button';
import { IconButton } from '@/components/ui/icon-button';
import { StepTrack, type StepTrackStep } from '@/components/ui/step-track';
import { Text, TextField } from '@/components/ui/text';
import { API_URL } from '@/lib/auth';
import { ICON } from '@/lib/colors';
import type { PublicAi } from '@zilar/client-core';
import { getSessionToken } from '@/lib/session-token';
import { LimitsFields } from '@/components/ais/limits-fields';
import { describeAisError } from '@/components/ais/errors';
import { SegmentedControl, type SegmentedOption } from '@/components/ui/segmented-control';
import { SelectSheet } from '@/components/ui/select-sheet';
import { iconKey } from '@/lib/depth';
import { makeMachinesApi } from '@/lib/machines-api';
import { useApi } from '@/lib/use-mockable-api';

import { KeyStep } from './key-step';
import { ProviderStep } from './provider-step';
import type { ComputerMode } from '@zilar/chat-core';

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

const ORB_PREVIEW_SIZE = 36;
const ORB_BIG_SIZE = 148;
/** The board clamps the dragged light to 0.4 of the radius. */
const MAX_LIGHT = 0.4;

function lightPoint(params: OrbParams): { x: number; y: number } {
  return {
    x: 50 + Math.cos(params.angle) * params.distance * 100,
    y: 50 + Math.sin(params.angle) * params.distance * 100,
  };
}

function backPoint(params: OrbParams): { x: number; y: number } {
  return { x: 50 - Math.cos(params.angle) * 28, y: 50 - Math.sin(params.angle) * 28 };
}

function OrbSvg({ params, size, svgRef }: { params: OrbParams; size: number; svgRef?: Ref<Svg> }) {
  const id = useId().replace(/[^a-zA-Z0-9]/gu, '');
  const light = lightPoint(params);
  const back = backPoint(params);
  const hue = Math.round(params.hue);
  const rim = Math.round(params.rim);
  return (
    <Svg ref={svgRef} width={size} height={size} viewBox="0 0 100 100">
      <Defs>
        <RadialGradient id={`${id}-body`} cx={`${light.x}%`} cy={`${light.y}%`} r="75%">
          <Stop offset="0" stopColor={`hsl(${hue}, 85%, 72%)`} />
          <Stop offset="0.55" stopColor={`hsl(${hue}, 75%, 46%)`} />
          <Stop offset="1" stopColor={`hsl(${hue}, 80%, 16%)`} />
        </RadialGradient>
        <RadialGradient id={`${id}-rim`} cx={`${back.x}%`} cy={`${back.y}%`} r="55%">
          <Stop offset="0.6" stopColor={`hsl(${rim}, 90%, 70%)`} stopOpacity="0" />
          <Stop offset="1" stopColor={`hsl(${rim}, 90%, 70%)`} stopOpacity="0.55" />
        </RadialGradient>
        <RadialGradient id={`${id}-gloss`} cx={`${light.x}%`} cy={`${light.y}%`} r="18%">
          <Stop offset="0" stopColor="#ffffff" stopOpacity="0.95" />
          <Stop offset="1" stopColor="#ffffff" stopOpacity="0" />
        </RadialGradient>
      </Defs>
      <Circle cx="50" cy="50" r="50" fill={`url(#${id}-body)`} />
      <Circle cx="50" cy="50" r="50" fill={`url(#${id}-rim)`} />
      <Circle cx="50" cy="50" r="50" fill={`url(#${id}-gloss)`} />
    </Svg>
  );
}

function OrbImage({ params, size = ORB_PREVIEW_SIZE }: { params: OrbParams; size?: number }) {
  return <OrbSvg params={params} size={size} />;
}

interface OrbCaptureHandle {
  capture(): Promise<string | null>;
}

/**
 * The hidden orb used for the create upload: `react-native-svg`'s `toDataURL` hands back the base64 PNG.
 */
const OrbCapture = forwardRef<OrbCaptureHandle, { params: OrbParams }>(function OrbCapture(
  { params },
  handle,
) {
  const svg = useRef<Svg | null>(null);
  useImperativeHandle(
    handle,
    () => ({
      capture: () => captureOrbPng(svg.current),
    }),
    [],
  );
  return (
    <View pointerEvents="none" style={{ position: 'absolute', left: -1000, top: 0 }}>
      <OrbSvg params={params} size={ORB_EXPORT_SIZE} svgRef={svg} />
    </View>
  );
});

function Swatch({
  label,
  color,
  size,
  selected,
  onPress,
}: {
  label: string;
  color: string;
  size: number;
  selected: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityLabel={label}
      accessibilityState={{ selected }}
      onPress={onPress}
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        backgroundColor: color,
        borderWidth: selected ? 2 : 0,
        borderColor: '#ededed',
      }}
    />
  );
}

function OrbView({ flow }: { flow: NewAiFlow }) {
  const size = ORB_BIG_SIZE;
  const place = (x: number, y: number): void => {
    const dx = x - size / 2;
    const dy = y - size / 2;
    flow.setOrbLight(Math.atan2(dy, dx), Math.min(MAX_LIGHT, Math.hypot(dx, dy) / (size / 2)));
  };
  const pan = Gesture.Pan()
    .runOnJS(true)
    .onBegin((event) => place(event.x, event.y))
    .onUpdate((event) => place(event.x, event.y));

  const light = lightPoint(flow.orbParams);
  const selectedHue = Math.round(flow.orbParams.hue);
  const selectedRim = Math.round(flow.orbParams.rim);

  return (
    <View className="gap-4">
      <View className="items-center pt-1">
        <GestureDetector gesture={pan}>
          <View
            accessible
            accessibilityRole="adjustable"
            accessibilityLabel="Drag to move the light"
            style={{ width: size, height: size }}
          >
            <OrbImage params={flow.orbParams} size={size} />
            <View
              pointerEvents="none"
              style={{
                position: 'absolute',
                left: `${light.x}%`,
                top: `${light.y}%`,
                width: 18,
                height: 18,
                marginLeft: -10,
                marginTop: -10,
                borderRadius: 9,
                borderWidth: 1,
                borderColor: 'rgba(255, 255, 255, 0.9)',
              }}
            />
          </View>
        </GestureDetector>
      </View>

      <View className="gap-2.5">
        <Text className="text-[13px] font-medium text-foreground">Color</Text>
        <View className="flex-row flex-wrap gap-x-2 gap-y-3">
          {ORB_HUES.map((choice) => (
            <Swatch
              key={choice.value}
              label={choice.name}
              color={`hsl(${choice.value}, 85%, 72%)`}
              size={34}
              selected={selectedHue === choice.value}
              onPress={() => flow.setOrbHue(choice.value)}
            />
          ))}
        </View>
      </View>

      <View className="gap-2.5">
        <Text className="text-[13px] font-medium text-foreground">Light</Text>
        <View className="flex-row gap-x-2">
          {ORB_RIMS.map((choice) => (
            <Swatch
              key={choice.value}
              label={choice.name}
              color={`hsl(${choice.value}, 90%, 70%)`}
              size={30}
              selected={selectedRim === choice.value}
              onPress={() => flow.setOrbRim(choice.value)}
            />
          ))}
        </View>
      </View>
    </View>
  );
}

function useNewAiFlow({
  onCreated,
}: {
  onCreated: (ai: PublicAi, partialFailure: boolean) => void;
}) {
  const { api } = useApi(makeAisApi);
  const { api: machinesApi } = useApi(makeMachinesApi);
  const { api: connectionsApi } = useApi(makeAisApi);
  const port = useMemo<NewAiFlowPort>(
    () => ({
      ...connectionsApi,
      ...api,
      setAiMachine: machinesApi.setAiMachine,
      listMachines: machinesApi.listMachines,
    }),
    [api, machinesApi, connectionsApi],
  );
  const flow = useNewAiFlowState(port);
  const [orbOpen, setOrbOpen] = useState(false);
  const [error, setError] = useState('');
  const keys = { ...flow.keys, providerChoices: flow.keys.choices };

  const create = (captureOrb: (() => Promise<string | null>) | null): void => {
    setError('');
    void flow
      .create((ai) => saveOrbAvatar(ai.id, captureOrb))
      .then((outcome) => {
        if (outcome === null) return;
        if (outcome.status === 'invalid') {
          setError(
            outcome.reason === 'limits'
              ? 'Check the spending limits.'
              : 'Choose a provider key first.',
          );
          return;
        }
        onCreated(outcome.ai, outcome.partial);
      })
      .catch((cause: unknown) => {
        const fixed = 'Could not create the AI.';
        setError(cause instanceof ApiError ? describeAisError(cause, fixed).message : fixed);
      });
  };

  return {
    ...flow,
    keys,
    goToStep: (value: string) => flow.goToStep(value as NewAiStep),
    primaryDisabled: keys.checkingKey || flow.creating || !flow.canAdvance,
    busy: keys.checkingKey || flow.creating,
    advance: (): void => {
      setError('');
      flow.advance();
    },
    create,
    error,
    abandon: keys.abandon,
    orbOpen,
    openOrb: () => setOrbOpen(true),
    closeOrb: () => setOrbOpen(false),
    computer: flow.computerMode,
    setComputer: (value: ComputerMode) => {
      flow.setComputerMode(value);
      setError('');
    },
    shuffleOrb: flow.shuffle,
  };
}

type NewAiFlow = ReturnType<typeof useNewAiFlow>;

/**
 * Rasterises the off-screen orb to a 256×256 base64 PNG, writes it to the cache dir and PUTs it to the AI's avatar slot (kind `ai`, owner the new AI's id). React Native's `fetch` cannot send binary bodies, so the file goes up with `createAvatarFileUploader`.
 */
const ORB_EXPORT_SIZE = 256;

/** A capture that overruns this is treated as a partial failure, like a failed upload. */
const ORB_CAPTURE_TIMEOUT_MS = 5000;

/** The AI's avatar slot, resolved against the API origin (the path is relative). */
function aiAvatarUrl(aiId: string): string {
  return `${API_URL}/api/avatars/ai/${encodeURIComponent(aiId)}`;
}

function pngBytesFromBase64(base64: string): Uint8Array {
  const comma = base64.indexOf(',');
  const payload = base64.startsWith('data:') && comma !== -1 ? base64.slice(comma + 1) : base64;
  const binary = globalThis.atob(payload);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function captureOrbPng(node: Svg | null): Promise<string | null> {
  return new Promise<string | null>((resolve) => {
    if (node === null) {
      resolve(null);
      return;
    }
    node.toDataURL((base64: string) => resolve(base64), {
      width: ORB_EXPORT_SIZE,
      height: ORB_EXPORT_SIZE,
    });
  });
}

async function uploadOrbAvatar(aiId: string, bytes: Uint8Array, token: string): Promise<void> {
  const { File, Paths } = await import('expo-file-system');
  const { createAvatarFileUploader } = await import('@/components/settings/avatar-native');
  const file = new File(Paths.cache, `ai-orb-${aiId}.png`);
  file.create({ overwrite: true });
  file.write(bytes);
  await createAvatarFileUploader().upload(
    aiAvatarUrl(aiId),
    { uri: file.uri, mimeType: 'image/png', width: ORB_EXPORT_SIZE, height: ORB_EXPORT_SIZE },
    token,
  );
}

/** Gives up after the timeout so a stuck view cannot hang Create. */
async function captureTimed(capture: () => Promise<string | null>): Promise<string | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      capture(),
      new Promise<null>((resolve) => {
        timer = setTimeout(() => resolve(null), ORB_CAPTURE_TIMEOUT_MS);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

async function saveOrbAvatar(
  aiId: string,
  capture: (() => Promise<string | null>) | null,
): Promise<boolean> {
  const base64Png = capture === null ? null : await captureTimed(capture);
  const token = base64Png === null ? undefined : await getSessionToken();
  if (base64Png === null || token === undefined) return false;
  const bytes = pngBytesFromBase64(base64Png);
  const { AVATAR_UPLOAD_MAX_BYTES } = await import('@/components/settings/avatar-native');
  if (bytes.byteLength > AVATAR_UPLOAD_MAX_BYTES) return false;
  await uploadOrbAvatar(aiId, bytes, token);
  return true;
}
