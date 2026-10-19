// effect-plain: the New AI wizard is plain React state; its async is the shared key-check and create calls over the injected promise APIs.
import { ApiError } from '@zilar/api-contract';
import {
  makeAisApi,
  useNewAiFlowState,
  type NewAiFlowPort,
  type NewAiStep,
} from '@zilar/client-core';
import { makeMachinesApi } from '@/lib/machines-api';
import { useApi } from '@/lib/use-mockable-api';
import { useMemo, useState } from 'react';

import type { ComputerMode } from '@/components/ais/computer-picker';
import { describeAisError } from '@/components/ais/errors';
import type { PublicAi } from '@/lib/ais-api';

import { saveOrbAvatar } from './orb-upload';

export type { NewAiStep, OrbParams } from '@zilar/client-core';

export function useNewAiFlow({
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

export type NewAiFlow = ReturnType<typeof useNewAiFlow>;
