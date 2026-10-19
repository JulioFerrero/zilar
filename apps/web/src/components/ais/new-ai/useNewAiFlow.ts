// effect-plain: the New AI wizard is plain React state over the shared hook; the orb PNG export is a browser promise edge.
import { orbDataUri, orbParamsFor, type OrbLight } from '@zilar/chat-core';
import {
  NEW_AI_STEPS,
  makeAisApi,
  useNewAiFlowState,
  type NewAiFlowPort,
  type NewAiStep,
} from '@zilar/client-core';
import { useState } from 'react';
import { ApiError, listMachines, uploadAvatar, type PublicAi } from '@/lib/api';
import { callApi } from '@/lib/effect/api-client';
import { useToast } from '@/components/ui/toast';
import { describeAiError } from '../errors';

const ORB_PNG_SIDE = 256;
const CREATE_FAILED = 'Could not create the AI';
const PARTIAL_FAILURE =
  "AI created. Some settings could not be saved; change them in the AI's settings.";

export type OrbParams = ReturnType<typeof orbParamsFor>;

const PORT: NewAiFlowPort = { ...makeAisApi(callApi), listMachines };

const STEP_INDEX: Record<NewAiStep, number> = { provider: 0, key: 1, model: 2, setup: 3 };

/** Renders the orb's SVG data URI to a 256×256 PNG; a null blob means the browser could not encode it. */
function orbPngBlob(params: OrbParams, idSeed: string): Promise<Blob | null> {
  return new Promise((resolve) => {
    const image = new Image();
    image.decoding = 'async';
    image.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = ORB_PNG_SIDE;
      canvas.height = ORB_PNG_SIDE;
      const context = canvas.getContext('2d');
      if (context === null) {
        resolve(null);
        return;
      }
      context.drawImage(image, 0, 0, ORB_PNG_SIDE, ORB_PNG_SIDE);
      canvas.toBlob((blob) => resolve(blob), 'image/png');
    };
    image.onerror = () => resolve(null);
    image.src = orbDataUri(params, idSeed);
  });
}

export interface NewAiFlowOptions {
  onClose: () => void;
  onCreated: (created: PublicAi) => void;
}

export function useNewAiFlow({ onClose, onCreated }: NewAiFlowOptions) {
  const toast = useToast();
  const [error, setError] = useState('');
  const flow = useNewAiFlowState(PORT, { orbName: (value) => value });
  const keys = flow.keys;

  const create = (): void => {
    setError('');
    void flow
      .create(async (created) => {
        const blob = await orbPngBlob(flow.orbParams, flow.name.trim());
        if (blob === null) return false;
        await uploadAvatar('ai', created.id, blob);
        return true;
      })
      .then((outcome) => {
        if (outcome === null || outcome.status !== 'created') return;
        if (outcome.partial) toast(PARTIAL_FAILURE);
        onCreated(outcome.ai);
      })
      .catch((cause: unknown) => {
        // A status of 0 means the create never reached the server; its ApiError text is not a
        // server answer, so show the same fixed sentence the old failure path showed.
        setError(
          cause instanceof ApiError && cause.status === 0
            ? CREATE_FAILED
            : describeAiError(cause, CREATE_FAILED).message,
        );
      });
  };

  const providerText = keys.providerText;
  const modelName =
    flow.modelOptions.find((option) => option.value === flow.model)?.label ?? flow.model;
  const modelLabel =
    providerText !== '' && modelName.startsWith(`${providerText} `)
      ? modelName.slice(providerText.length + 1)
      : modelName;

  return {
    ...flow,
    steps: [
      { label: 'Provider', value: providerText },
      { label: 'Key', value: 'Key' },
      { label: 'Model', value: modelLabel },
      { label: 'Setup' },
    ],
    step: STEP_INDEX[flow.step],
    goToStep: (index: number) => {
      const next = NEW_AI_STEPS[index];
      if (next !== undefined) flow.goToStep(next);
    },
    primary: (): void => {
      if (flow.step === 'key') keys.continueKey();
      else if (flow.step === 'setup') create();
      else if (flow.canContinue) flow.advance();
    },
    primaryLabel: keys.checkingKey ? 'Checking…' : flow.step === 'setup' ? 'Create AI' : 'Continue',
    primaryDisabled: flow.creating || keys.checkingKey || !flow.canContinue,
    busy: flow.creating,
    error,
    close: (): void => {
      keys.abandon();
      onClose();
    },
    cloudAvailable: flow.cloud,
    setOrbLight: (light: OrbLight) => flow.setOrbLight(light.angle, light.distance),
  };
}

export type NewAiFlow = ReturnType<typeof useNewAiFlow>;
