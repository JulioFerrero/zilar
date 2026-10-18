import { useState } from 'react';
import { View } from 'react-native';

import { KeyStep } from '@/components/ais/new-ai/key-step';
import { ProviderStep } from '@/components/ais/new-ai/provider-step';
import { BottomSheet } from '@/components/ui/bottom-sheet';
import { Button } from '@/components/ui/button';
import { StepTrack, type StepTrackStep } from '@/components/ui/step-track';
import { Text } from '@/components/ui/text';

import { useKeyCheck } from './use-key-check';

export function AddKeySheet({
  visible,
  onClose,
  onSaved,
}: {
  visible: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const keys = useKeyCheck();
  const [step, setStep] = useState(0);

  const providerLabel =
    keys.choices.find((choice) => choice.id === keys.providerId)?.label ??
    keys.providerId ??
    'Provider';
  const steps: StepTrackStep[] = [
    { value: 'provider', label: keys.providerId === null ? 'Provider' : providerLabel },
    { value: 'key', label: 'Key' },
  ];

  const close = (): void => {
    keys.abandon();
    onClose();
  };

  const primary = (): void => {
    if (step === 0) {
      if (keys.continueProvider()) setStep(1);
      return;
    }
    if (keys.keyVerified) {
      keys.claim();
      onSaved();
      return;
    }
    keys.continueKey();
  };

  const primaryDisabled =
    step === 0
      ? !keys.providerReady
      : keys.checkingKey || (!keys.keyVerified && keys.key.trim() === '');

  return (
    <BottomSheet
      visible={visible}
      onClose={close}
      closeLabel="Close Add key"
      title="Add key"
      footer={
        <View className="flex-row items-center gap-2">
          {step > 0 ? (
            <Button variant="ghost" disabled={keys.checkingKey} onPress={() => setStep(0)}>
              <Text>Back</Text>
            </Button>
          ) : null}
          <Button className="flex-1" disabled={primaryDisabled} onPress={primary}>
            <Text>{step === 0 ? 'Continue' : keys.keyVerified ? 'Save' : 'Continue'}</Text>
          </Button>
        </View>
      }
    >
      <View className="gap-4">
        <StepTrack
          steps={steps}
          current={step === 0 ? 'provider' : 'key'}
          onStepPress={() => {
            if (!keys.checkingKey) setStep(0);
          }}
        />
        {step === 0 ? <ProviderStep keys={keys} /> : null}
        {step === 1 ? <KeyStep keys={keys} /> : null}
      </View>
    </BottomSheet>
  );
}
