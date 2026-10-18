import { useState } from 'react';
import { Effect } from 'effect';
import { AsyncResult } from 'effect/reactivity';
import type { AiCatalogModel, AiComputerMode } from '@zilar/api-contract';
import {
  clampOrbLight,
  defaultCatalogModelId,
  defaultModelFor,
  defaultPersonaFor,
  modelSuggestionsFor,
  orbParamsFor,
  orbDataUri,
  shuffleOrb,
  validateLimits,
  buildCreateBody,
  type AiTemplateId,
  type OrbLight,
} from '@zilar/chat-core';
import {
  ApiError,
  createAi,
  getComputerOptions,
  listMachines,
  setAiMachine,
  updateAi,
  uploadAvatar,
  type Machine,
  type PublicAi,
} from '@/lib/api';
import { fromApi, type ApiFailure } from '@zilar/client-core';
import { failureOf, isWaiting, useAction } from '@/lib/effect/use-action';
import { useQuery } from '@/lib/effect/use-query';
import { useToast } from '@/components/ui/toast';
import { describeAiError, type AiErrorInfo } from '../errors';
import { useKeyCheck } from './useKeyCheck';

// `@zilar/ball-avatar` is not a web dependency; the orb parameters come back
// from `orbDataUri`, so this names the same shape without importing it.
type OrbPngParams = Parameters<typeof orbDataUri>[0];

const ORB_PNG_SIDE = 256;

/**
 * Renders the orb's SVG data URI to a 256×256 PNG; a null blob means the
 * browser could not decode or encode the image.
 */
function orbPngBlob(params: OrbPngParams, idSeed: string): Effect.Effect<Blob | null> {
  return Effect.callback<Blob | null>((resume) => {
    const image = new Image();
    image.decoding = 'async';
    image.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = ORB_PNG_SIDE;
      canvas.height = ORB_PNG_SIDE;
      const context = canvas.getContext('2d');
      if (context === null) {
        resume(Effect.succeed(null));
        return;
      }
      context.drawImage(image, 0, 0, ORB_PNG_SIDE, ORB_PNG_SIDE);
      canvas.toBlob((blob) => resume(Effect.succeed(blob)), 'image/png');
    };
    image.onerror = () => resume(Effect.succeed(null));
    image.src = orbDataUri(params, idSeed);
    return Effect.sync(() => {
      image.onload = null;
      image.onerror = null;
    });
  });
}

const COMPUTER_MODES: readonly AiComputerMode[] = ['off', 'cloud', 'runner', 'auto'];
const TEMPLATES: readonly AiTemplateId[] = ['dev', 'marketing', 'fun'];
const PARTIAL_FAILURE =
  "AI created. Some settings could not be saved; change them in the AI's settings.";

type OrbParams = ReturnType<typeof orbParamsFor>;

const isComputerMode = (value: string): value is AiComputerMode =>
  (COMPUTER_MODES as readonly string[]).includes(value);

const isTemplate = (value: string): value is AiTemplateId =>
  (TEMPLATES as readonly string[]).includes(value);

function describeFailure(failure: ApiFailure, fallback: string): AiErrorInfo {
  if (failure.status === 0) return { message: fallback, unavailable: false };
  return describeAiError(
    new ApiError(failure.status, failure.code, failure.message, failure.detail),
    fallback,
  );
}

export interface NewAiFlowOptions {
  onClose: () => void;
  onCreated: (created: PublicAi) => void;
}

export function useNewAiFlow({ onClose, onCreated }: NewAiFlowOptions) {
  const toast = useToast();
  const [optionsResult] = useQuery(() => fromApi(() => getComputerOptions()), []);
  const [machinesResult] = useQuery(() => fromApi(() => listMachines()), []);
  const cloudAvailable = AsyncResult.isSuccess(optionsResult) ? optionsResult.value.cloud : false;
  const machines: Machine[] = AsyncResult.isSuccess(machinesResult) ? machinesResult.value : [];
  const [step, setStep] = useState(0);
  const [name, setName] = useState('');
  const [template, setTemplateValue] = useState<AiTemplateId>('dev');
  const [modelDraft, setModelDraft] = useState<string | null>(null);
  const [orbParams, setOrbParams] = useState<OrbParams | null>(null);
  const [computerMode, setComputerModeValue] = useState<AiComputerMode>('off');
  const [machineId, setMachineIdValue] = useState<string | null>(null);
  const [day, setDay] = useState('');
  const [month, setMonth] = useState('');
  const keys = useKeyCheck({
    onProviderChange: () => setModelDraft(null),
    onVerified: () => setStep(2),
  });
  const catalogModels: readonly AiCatalogModel[] =
    keys.catalog?.providers.find((provider) => provider.id === keys.providerId)?.models ?? [];

  const model =
    modelDraft ?? (defaultCatalogModelId(catalogModels) || defaultModelFor(keys.providerId ?? ''));
  const modelOptions =
    catalogModels.length > 0
      ? catalogModels.map((entry) => ({ value: entry.id, label: entry.name }))
      : modelSuggestionsFor(keys.providerId ?? '').map((id) => ({ value: id, label: id }));

  const limits = validateLimits(day, month);
  const needsMachine = computerMode === 'runner' || computerMode === 'auto';
  const machineReady = !needsMachine || machineId !== null;
  const canCreate =
    keys.connectionId !== null &&
    name.trim() !== '' &&
    model.trim() !== '' &&
    limits.limits !== null &&
    machineReady;
  const canContinue =
    step === 0
      ? keys.providerReady
      : step === 1
        ? keys.keyVerified || keys.key.trim() !== ''
        : step === 2
          ? name.trim() !== '' && model.trim() !== ''
          : canCreate;

  const [createState, create] = useAction<void, void, ApiFailure>(() => {
    const body = buildCreateBody(
      {
        name,
        template,
        persona: defaultPersonaFor(template),
        personaTouched: false,
        providerConnectionId: keys.connectionId,
        model,
      },
      limits.limits,
    );
    if (body === null || keys.connectionId === null || limits.limits === null) {
      return Effect.void;
    }
    const orb = orbParams;
    const mode = computerMode;
    const chosenMachine = machineId;
    const seed = name.trim();
    return Effect.gen(function* () {
      const created = yield* fromApi(() => createAi(body));
      let partial = false;
      if (orb !== null) {
        const blob = yield* orbPngBlob(orb, seed);
        const saved =
          blob === null
            ? null
            : yield* fromApi(() => uploadAvatar('ai', created.id, blob)).pipe(
                Effect.orElseSucceed(() => null),
              );
        if (saved === null) partial = true;
      }
      if (mode !== 'off') {
        if (chosenMachine !== null) {
          const assigned = yield* fromApi(() => setAiMachine(created.id, chosenMachine)).pipe(
            Effect.orElseSucceed(() => null),
          );
          if (assigned === null) partial = true;
        }
        const updated = yield* fromApi(() => updateAi(created.id, { computerMode: mode })).pipe(
          Effect.orElseSucceed(() => null),
        );
        if (updated === null) partial = true;
      }
      if (partial) {
        toast(PARTIAL_FAILURE);
      }
      yield* Effect.sync(() => onCreated(created));
    });
  });

  const setOrb = (patch: Partial<OrbParams>): void =>
    setOrbParams((current) => ({ ...(current ?? orbParamsFor(name)), ...patch }));

  const primary = (): void => {
    if (step === 1) {
      keys.continueKey();
    } else if (step === 3) {
      create();
    } else if (canContinue) {
      setStep(step + 1);
    }
  };

  const close = (): void => {
    keys.abandon();
    onClose();
  };

  const providerText = keys.providerText;
  const modelName = catalogModels.find((entry) => entry.id === model)?.name ?? model;
  const modelLabel =
    providerText !== '' && modelName.startsWith(`${providerText} `)
      ? modelName.slice(providerText.length + 1)
      : modelName;
  const createFailure = failureOf(createState);

  return {
    keys,
    steps: [
      { label: 'Provider', value: providerText },
      { label: 'Key', value: 'Key' },
      { label: 'Model', value: modelLabel },
      { label: 'Setup' },
    ],
    step,
    goToStep: (index: number) => {
      if (index < step) setStep(index);
    },
    back: () => setStep((current) => Math.max(0, current - 1)),
    primary,
    primaryLabel: keys.checkingKey ? 'Checking…' : step === 3 ? 'Create AI' : 'Continue',
    primaryDisabled: isWaiting(createState) || keys.checkingKey || !canContinue,
    busy: isWaiting(createState),
    error:
      createFailure === undefined
        ? ''
        : describeFailure(createFailure, 'Could not create the AI').message,
    close,
    name,
    setName,
    model,
    setModel: setModelDraft,
    modelOptions,
    template,
    setTemplate: (value: string) => {
      if (isTemplate(value)) setTemplateValue(value);
    },
    orbParams: orbParams ?? orbParamsFor(name),
    orbEdited: orbParams !== null,
    setOrbHue: (hue: number) => setOrb({ hue }),
    setOrbRim: (rim: number) => setOrb({ rim }),
    setOrbLight: (light: OrbLight) => setOrb(clampOrbLight(light.angle, light.distance)),
    shuffle: () => setOrbParams(shuffleOrb(Math.random)),
    resetOrb: () => setOrbParams(null),
    cloudAvailable,
    computerMode,
    setComputerMode: (value: string) => {
      if (isComputerMode(value)) setComputerModeValue(value);
    },
    machines,
    machineId,
    setMachineId: setMachineIdValue,
    day,
    setDay,
    month,
    setMonth,
    dayError: limits.dayError,
    monthError: limits.monthError,
  };
}

export type NewAiFlow = ReturnType<typeof useNewAiFlow>;
