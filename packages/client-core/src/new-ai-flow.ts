// effect-plain: the New AI wizard is plain React state over the shared promise APIs; the key check owns its own async edge.
import { useEffect, useRef, useState } from 'react';
import type { AiComputerMode, AiComputerOptions, Machine } from '@zilar/api-contract';
import {
  buildCreateBody,
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

import type { CreateAiInput, PublicAi, UpdateAiInput } from './ais-api';
import { useKeyCheck, type KeyCheckPort } from './key-check';

export type NewAiStep = 'provider' | 'key' | 'model' | 'setup';
export const NEW_AI_STEPS: readonly NewAiStep[] = ['provider', 'key', 'model', 'setup'];
export type OrbParams = ReturnType<typeof orbParamsFor>;

const TEMPLATES: readonly string[] = ['dev', 'marketing', 'fun'];
const COMPUTER_MODES: readonly string[] = ['off', 'cloud', 'runner', 'auto'];

/** What differs between web and phone: the key-check calls plus the AI and machine calls. */
export interface NewAiFlowPort extends KeyCheckPort {
  createAi(input: CreateAiInput): Promise<PublicAi>;
  updateAi(id: string, input: UpdateAiInput): Promise<PublicAi>;
  /**
   * Attaches the machine, or clears it when `machineId` is null. The resolved value is
   * ignored: the AI's API returns the updated AI and the machines API returns the machine
   * id, so the port accepts either; only a rejection counts as a partial failure.
   */
  setAiMachine(aiId: string, machineId: string | null): Promise<unknown>;
  listMachines(): Promise<readonly Machine[]>;
  getComputerOptions(): Promise<AiComputerOptions>;
}
export interface NewAiFlowOptions {
  /** The seed the default orb takes from the name; web keeps the typed name, the phone trims it. */
  orbName?: (name: string) => string;
}
export type NewAiCreateOutcome =
  | { status: 'created'; ai: PublicAi; partial: boolean }
  | { status: 'invalid'; reason: 'limits' | 'key' };

const attempt = async (run: () => Promise<unknown>): Promise<boolean> => {
  try {
    await run();
    return true;
  } catch {
    return false;
  }
};

/**
 * The New AI wizard state shared by web and phone: one step list, the fields, the
 * catalog models, and the create sequence that attaches the machine and reports a
 * partial failure. Each app supplies its calls and keeps its errors, toasts and orb.
 */
export function useNewAiFlowState(port: NewAiFlowPort, options: NewAiFlowOptions = {}) {
  const orbName = options.orbName ?? ((value: string) => value.trim() || 'ai');
  const [step, setStep] = useState<NewAiStep>('provider');
  const [name, setName] = useState('');
  const [template, setTemplateValue] = useState<AiTemplateId>('dev');
  const [model, setModel] = useState<string | null>(null);
  const [orb, setOrb] = useState<OrbParams | null>(null);
  const [computerMode, setComputerModeValue] = useState<AiComputerMode>('off');
  const [machineId, setMachineId] = useState<string | null>(null);
  const [day, setDay] = useState('');
  const [month, setMonth] = useState('');
  const [cloud, setCloud] = useState(false);
  const [machines, setMachines] = useState<readonly Machine[]>([]);
  const [creating, setCreating] = useState(false);
  const creatingRef = useRef(false);
  const keys = useKeyCheck(port, {
    onProviderChange: () => setModel(null),
    onVerified: () => setStep('model'),
  });

  useEffect(() => {
    let active = true;
    void Promise.allSettled([port.getComputerOptions(), port.listMachines()]).then(
      ([optionsResult, machineList]) => {
        if (!active) return;
        if (optionsResult.status === 'fulfilled') setCloud(optionsResult.value.cloud);
        if (machineList.status === 'fulfilled') {
          setMachines(machineList.value.filter((machine) => machine.status === 'approved'));
        }
      },
    );
    return () => {
      active = false;
    };
  }, [port]);

  const models =
    keys.catalog?.providers.find((provider) => provider.id === keys.providerId)?.models ?? [];
  const chosenModel =
    model ?? (defaultCatalogModelId(models) || defaultModelFor(keys.providerId ?? ''));
  const modelOptions =
    models.length > 0
      ? models.map((entry) => ({ value: entry.id, label: entry.name }))
      : modelSuggestionsFor(keys.providerId ?? '').map((id) => ({ value: id, label: id }));
  const limits = validateLimits(day, month);
  const canCreate =
    keys.connectionId !== null &&
    name.trim() !== '' &&
    chosenModel.trim() !== '' &&
    limits.limits !== null &&
    (machineId !== null || (computerMode !== 'runner' && computerMode !== 'auto'));
  const canContinue =
    step === 'provider'
      ? keys.providerReady
      : step === 'key'
        ? keys.keyVerified || keys.key.trim() !== ''
        : step === 'model'
          ? name.trim() !== '' && chosenModel.trim() !== ''
          : canCreate;
  /** The phone lets Continue show why a compatible provider is incomplete; web disables it. */
  const canAdvance = step === 'provider' ? keys.providerId !== null : canContinue;
  const patchOrb = (patch: Partial<OrbParams>): void =>
    setOrb((current) => ({ ...(current ?? orbParamsFor(orbName(name))), ...patch }));

  function advance(): void {
    if (step === 'provider' && keys.continueProvider()) setStep('key');
    else if (step === 'key') keys.continueKey();
    else if (step === 'model') setStep('setup');
  }

  function back(): void {
    if (step === 'key') setStep('provider');
    else if (step === 'model') setStep('key');
    else if (step === 'setup') setStep('model');
  }

  function goToStep(value: NewAiStep): void {
    if (keys.checkingKey) return;
    if (value === 'provider' && step !== 'provider') setStep('provider');
    else if (value === 'key' && (step === 'model' || step === 'setup')) setStep('key');
    else if (value === 'model' && step === 'setup') setStep('model');
  }

  /**
   * Creates the AI, then attaches the machine and computer mode; `null` means a
   * submit is already in flight. The app's orb upload runs between the two and a
   * failure there counts as partial, like the others.
   */
  async function create(
    uploadOrb?: (created: PublicAi) => Promise<boolean>,
  ): Promise<NewAiCreateOutcome | null> {
    if (creatingRef.current) return null;
    const body = buildCreateBody(
      {
        name,
        template,
        persona: defaultPersonaFor(template),
        personaTouched: false,
        providerConnectionId: keys.connectionId,
        model: chosenModel,
      },
      limits.limits,
    );
    if (body === null || keys.connectionId === null || limits.limits === null) {
      return { status: 'invalid', reason: limits.limits === null ? 'limits' : 'key' };
    }
    creatingRef.current = true;
    setCreating(true);
    keys.beginCreate();
    try {
      const ai = await port.createAi(body).catch((cause: unknown) => {
        keys.finishCreate(false);
        throw cause;
      });
      keys.finishCreate(true);
      let partial =
        orb !== null && uploadOrb !== undefined && !(await attempt(() => uploadOrb(ai)));
      if (computerMode !== 'off') {
        if (machineId !== null) {
          partial = !(await attempt(() => port.setAiMachine(ai.id, machineId))) || partial;
        }
        partial = !(await attempt(() => port.updateAi(ai.id, { computerMode }))) || partial;
      }
      return { status: 'created', ai, partial };
    } finally {
      creatingRef.current = false;
      setCreating(false);
    }
  }

  return {
    keys,
    step,
    advance,
    back,
    goToStep,
    canContinue,
    canAdvance,
    primaryLabel:
      step === 'setup'
        ? creating
          ? 'Creating…'
          : 'Create AI'
        : keys.checkingKey
          ? 'Checking…'
          : 'Continue',
    creating,
    create,
    name,
    setName,
    template,
    setTemplate: (value: string) => {
      if (TEMPLATES.includes(value)) setTemplateValue(value as AiTemplateId);
    },
    model: chosenModel,
    setModel,
    modelOptions,
    orbParams: orb ?? orbParamsFor(orbName(name)),
    orbEdited: orb !== null,
    setOrbHue: (hue: number) => patchOrb({ hue }),
    setOrbRim: (rim: number) => patchOrb({ rim }),
    setOrbLight: (angle: number, distance: number) => patchOrb(clampOrbLight(angle, distance)),
    shuffle: () => setOrb(shuffleOrb(Math.random)),
    resetOrb: () => setOrb(null),
    cloud,
    machines,
    computerMode,
    setComputerMode: (value: string) => {
      if (!COMPUTER_MODES.includes(value)) return;
      if (value === 'cloud' && !cloud) return;
      setComputerModeValue(value as AiComputerMode);
    },
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
