import { RotateCcw, Shuffle, X } from 'lucide-react-native';
import { useRef } from 'react';
import { View } from 'react-native';

import { BottomSheet } from '@/components/ui/bottom-sheet';
import { Button } from '@/components/ui/button';
import { IconButton } from '@/components/ui/icon-button';
import { StepTrack, type StepTrackStep } from '@/components/ui/step-track';
import { Text } from '@/components/ui/text';
import { ICON } from '@/lib/colors';
import type { PublicAi } from '@/lib/ais-api';

import { KeyStep } from './key-step';
import { ModelStep } from './model-step';
import { OrbCapture, OrbView, type OrbCaptureHandle } from './orb-view';
import { ProviderStep } from './provider-step';
import { SetupStep } from './setup-step';
import { useNewAiFlow } from './use-new-ai-flow';

/** "DeepSeek V4 Flash" reads as "V4 Flash" in the 34 px step track. */
function shortModelLabel(model: string): string {
  const words = model.split(/[\s/_-]+/u).filter((word) => word !== '');
  return words.length <= 2 ? model : words.slice(-2).join(' ');
}

/**
 * T-1445: the New AI sheet (the approved phone boards). One hugging `BottomSheet`
 * holds the Provider → Key → Model → Setup steps, the orb sub-view and the
 * footer. The close key, the grabber and Android back are the only ways out;
 * closing before Create abandons a half-made key check.
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
    flow.providerChoices.find((choice) => choice.id === flow.providerId)?.label ??
    flow.providerId ??
    'Provider';
  const trackSteps: StepTrackStep[] = [
    {
      value: 'provider',
      label: flow.providerId === null ? 'Provider' : providerLabel,
      done: flow.step !== 'provider',
    },
    { value: 'key', label: 'Key', done: flow.step === 'model' || flow.step === 'setup' },
    {
      value: 'model',
      label: flow.model === '' ? 'Model' : shortModelLabel(flow.model),
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
            {flow.step === 'provider' ? <ProviderStep flow={flow} /> : null}
            {flow.step === 'key' ? <KeyStep flow={flow} /> : null}
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
