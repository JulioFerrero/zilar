// effect-plain: the New AI wizard is plain React state; its async is the shared key-check and create calls over the injected promise APIs.
import { ApiError } from '@zilar/api-contract';
import {
  clampOrbLight,
  defaultCatalogModelId,
  defaultModelFor,
  defaultPersonaFor,
  modelSuggestionsFor,
  orbParamsFor,
  shuffleOrb,
  validateLimits,
  type AiTemplateId,
} from '@zilar/chat-core';
import { useEffect, useMemo, useRef, useState } from 'react';

import type { ComputerMode } from '@/components/ais/computer-picker';
import { describeAisError } from '@/components/ais/errors';
import { buildCreateInput, type WizardForm } from '@/components/ais/form';
import { useAisApi } from '@/components/ais/use-ais-api';
import { useKeyCheck } from '@/components/connections/use-key-check';
import { applyMachineChange } from '@/components/machines/machine-change';
import { useMachinesApi } from '@/components/machines/use-machines-api';
import type { SelectSheetOption } from '@/components/ui/select-sheet';
import type { PublicAi } from '@/lib/ais-api';
import type { Machine } from '@/lib/machines-api';

import { saveOrbAvatar } from './orb-upload';

export type NewAiStep = 'provider' | 'key' | 'model' | 'setup';

export type OrbParams = ReturnType<typeof orbParamsFor>;

export function useNewAiFlow({
  onCreated,
}: {
  onCreated: (ai: PublicAi, partialFailure: boolean) => void;
}) {
  const { api } = useAisApi();
  const { api: machinesApi } = useMachinesApi();

  const [step, setStep] = useState<NewAiStep>('provider');
  const [orbOpen, setOrbOpen] = useState(false);
  const [name, setName] = useState('');
  const [template, setTemplate] = useState<AiTemplateId>('dev');
  const [model, setModel] = useState('');
  const [orb, setOrb] = useState<OrbParams | null>(null);
  const [orbEdited, setOrbEdited] = useState(false);
  const [computer, setComputerState] = useState<ComputerMode>('off');
  const [machineId, setMachineId] = useState<string | null>(null);
  const [day, setDay] = useState('');
  const [month, setMonth] = useState('');
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState('');
  const [machines, setMachines] = useState<Machine[]>([]);
  const [cloud, setCloud] = useState(false);
  const createRef = useRef(false);

  // The provider, the compatible fields and the key check are shared with the Connections page's Add key sheet, so the steps read `flow.keys`.
  const keys = useKeyCheck({
    onProviderChange: () => setModel(''),
    onVerified: () => goToModel(),
  });

  useEffect(() => {
    let active = true;
    void (async () => {
      const [options, machineList] = await Promise.allSettled([
        api.getComputerOptions(),
        machinesApi.listMachines(),
      ]);
      if (!active) return;
      if (options.status === 'fulfilled') setCloud(options.value.cloud);
      if (machineList.status === 'fulfilled') {
        setMachines(machineList.value.filter((machine) => machine.status === 'approved'));
      }
    })();
    return () => {
      active = false;
    };
  }, [api, machinesApi]);

  const limits = validateLimits(day, month);
  const catalogModels = useMemo(() => {
    const provider = keys.catalog?.providers.find((entry) => entry.id === keys.providerId);
    return provider?.models ?? [];
  }, [keys.catalog, keys.providerId]);
  const modelOptions: SelectSheetOption[] =
    catalogModels.length > 0
      ? catalogModels.map((entry) => ({ value: entry.id, label: entry.name }))
      : modelSuggestionsFor(keys.providerId ?? '').map((value) => ({ value, label: value }));
  const orbParams = orbEdited && orb !== null ? orb : orbParamsFor(name.trim() || 'ai');

  function goToModel(): void {
    const fallback =
      (catalogModels.length > 0 ? defaultCatalogModelId(catalogModels) : '') ||
      defaultModelFor(keys.providerId ?? '');
    if (model.trim() === '' && fallback !== '') setModel(fallback);
    setStep('model');
  }

  function advance(): void {
    setError('');
    if (step === 'provider') {
      if (keys.continueProvider()) setStep('key');
      return;
    }
    if (step === 'key') {
      keys.continueKey();
      return;
    }
    if (step === 'model') setStep('setup');
  }

  function create(captureOrb: (() => Promise<string | null>) | null): void {
    if (createRef.current) return;
    const form: WizardForm = {
      name,
      template,
      persona: defaultPersonaFor(template),
      personaTouched: false,
      providerConnectionId: keys.connectionId,
      model,
    };
    const input = buildCreateInput(form, limits.limits);
    if (input === null) {
      setError(
        limits.limits === null ? 'Check the spending limits.' : 'Choose a provider key first.',
      );
      return;
    }
    createRef.current = true;
    keys.beginCreate();
    setCreating(true);
    setError('');
    void (async () => {
      let ai: PublicAi;
      try {
        ai = await api.createAi(input);
      } catch (cause) {
        setCreating(false);
        const fixed = 'Could not create the AI.';
        setError(cause instanceof ApiError ? describeAisError(cause, fixed).message : fixed);
        // A close during the POST left the key to this create: it failed, so drop it.
        keys.finishCreate(false);
        return;
      }
      // The connection is now the AI's, so closing must not delete it.
      keys.finishCreate(true);
      let partial = false;
      if (orbEdited) {
        try {
          partial = !(await saveOrbAvatar(ai.id, captureOrb));
        } catch {
          partial = true;
        }
      }
      if (computer !== 'off') {
        try {
          if (machineId !== null) {
            const outcome = await applyMachineChange(machinesApi, ai.id, machineId, null);
            if (outcome.error !== '') partial = true;
          }
          await api.updateAi(ai.id, { computerMode: computer });
        } catch {
          partial = true;
        }
      }
      setCreating(false);
      onCreated(ai, partial);
    })().finally(() => {
      createRef.current = false;
    });
  }

  function back(): void {
    if (step === 'key') setStep('provider');
    else if (step === 'model') setStep('key');
    else if (step === 'setup') setStep('model');
  }

  function goToStep(value: string): void {
    if (keys.checking) return;
    if (value === 'provider' && step !== 'provider') setStep('provider');
    else if (value === 'key' && (step === 'model' || step === 'setup')) setStep('key');
    else if (value === 'model' && step === 'setup') setStep('model');
  }

  function markOrb(next: OrbParams): void {
    setOrb(next);
    setOrbEdited(true);
  }

  const needsMachine = (computer === 'runner' || computer === 'auto') && machineId === null;
  const primaryDisabled =
    keys.checking ||
    creating ||
    (step === 'provider' && keys.providerId === null) ||
    (step === 'key' && !keys.keyVerified && keys.keyValue.trim() === '') ||
    (step === 'model' && (name.trim() === '' || model.trim() === '')) ||
    (step === 'setup' && (limits.limits === null || needsMachine));

  return {
    keys,
    step,
    goToStep,
    back,
    primaryLabel:
      step === 'setup'
        ? creating
          ? 'Creating…'
          : 'Create AI'
        : keys.checking
          ? 'Checking…'
          : 'Continue',
    primaryDisabled,
    busy: keys.checking || creating,
    advance,
    create,
    error,
    abandon: () => keys.abandon(),
    orbOpen,
    openOrb: () => setOrbOpen(true),
    closeOrb: () => setOrbOpen(false),
    name,
    setName,
    template,
    setTemplate,
    model,
    setModel,
    modelOptions,
    orbParams,
    setOrbHue: (hue: number) => markOrb({ ...orbParams, hue }),
    setOrbRim: (rim: number) => markOrb({ ...orbParams, rim }),
    setOrbLight: (angle: number, distance: number) =>
      markOrb({ ...orbParams, ...clampOrbLight(angle, distance) }),
    shuffleOrb: () => markOrb(shuffleOrb(Math.random)),
    resetOrb: () => {
      setOrbEdited(false);
      setOrb(null);
    },
    computer,
    setComputer: (value: ComputerMode) => {
      if (value === 'cloud' && !cloud) return;
      setComputerState(value);
      setError('');
    },
    cloud,
    machines,
    machineId,
    setMachineId,
    day,
    setDay,
    month,
    setMonth,
    dayError: limits.dayError,
    monthError: limits.monthError,
  };
}

export type NewAiFlow = ReturnType<typeof useNewAiFlow>;
