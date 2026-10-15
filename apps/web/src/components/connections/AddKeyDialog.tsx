import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { DialogStepper } from '@/components/ui/dialog-stepper';
import { KeyStep } from '../ais/new-ai/KeyStep';
import { ProviderStep } from '../ais/new-ai/ProviderStep';
import { useKeyCheck } from '../ais/new-ai/useKeyCheck';

/**
 * The Connections page's Add key dialog: the same Provider and Key steps as the
 * New AI flow. Continue runs the key check (which creates the connection), then
 * Save closes the dialog; closing before Save abandons an unverified connection.
 */
export function AddKeyDialog({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const keys = useKeyCheck();
  const [step, setStep] = useState(0);

  const close = (): void => {
    keys.abandon();
    onClose();
  };

  const primary = (): void => {
    if (step === 0) {
      if (!keys.providerReady) return;
      setStep(1);
      return;
    }
    if (keys.keyVerified) {
      onSaved();
      return;
    }
    keys.continueKey();
  };

  return (
    <Dialog
      open
      onClose={close}
      title="Add key"
      size="lg"
      stepper={
        <DialogStepper
          steps={[{ label: 'Provider', value: keys.providerText }, { label: 'Key' }]}
          current={step}
          onStep={setStep}
        />
      }
      onSubmit={(event) => {
        event.preventDefault();
        primary();
      }}
      footer={
        <>
          {step > 0 && (
            <Button
              type="button"
              variant="ghost"
              size="lg"
              className="key-icon mr-auto text-foreground"
              disabled={keys.checkingKey}
              onClick={() => setStep(0)}
            >
              Back
            </Button>
          )}
          <Button
            type="submit"
            size="lg"
            disabled={
              step === 0
                ? !keys.providerReady
                : keys.checkingKey || (!keys.keyVerified && keys.key.trim() === '')
            }
          >
            {step === 0 ? 'Continue' : keys.keyVerified ? 'Save' : 'Continue'}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {step === 0 && <ProviderStep keys={keys} />}
        {step === 1 && <KeyStep keys={keys} />}
      </div>
    </Dialog>
  );
}
