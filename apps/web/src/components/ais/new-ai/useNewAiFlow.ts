import { useRef, useState } from 'react';
import { Effect } from 'effect';
import { AsyncResult } from 'effect/reactivity';
import type { AiCatalog, AiCatalogModel, AiComputerMode } from '@zilar/api-contract';
import {
  abandonKeyCheck,
  checkKey,
  clampOrbLight,
  defaultCatalogModelId,
  defaultModelFor,
  defaultPersonaFor,
  keyPageFor,
  keyPlaceholderFor,
  modelSuggestionsFor,
  orbParamsFor,
  providerChoices,
  shuffleOrb,
  validateLimits,
  buildCreateBody,
  type AiTemplateId,
  type CatalogView,
  type KeyCheckApi,
  type KeyCheckInput,
  type KeyCheckResult,
  type KeyCheckState,
  type OrbLight,
} from '@zilar/chat-core';
import {
  ApiError,
  createAi,
  createConnection,
  deleteConnection,
  getAiCatalog,
  getComputerOptions,
  listConnections,
  listMachines,
  replaceConnectionKey,
  setAiMachine,
  testConnection,
  updateAi,
  uploadAvatar,
  type Machine,
  type PublicAi,
} from '@/lib/api';
import { fromApi } from '@/lib/effect/api-effect';
import type { ApiFailure } from '@/lib/effect/errors';
import { failureOf, isWaiting, useAction } from '@/lib/effect/use-action';
import { useQuery } from '@/lib/effect/use-query';
import { useToast } from '@/components/ui/toast';
import { describeAiError, type AiErrorInfo } from '../errors';
import { orbPngBlob } from './orb-png';

const COMPUTER_MODES: readonly AiComputerMode[] = ['off', 'cloud', 'runner', 'auto'];
const TEMPLATES: readonly AiTemplateId[] = ['dev', 'marketing', 'fun'];
const PARTIAL_FAILURE =
  "AI created. Some settings could not be saved; change them in the AI's settings.";

// `@zilar/ball-avatar` is not a web dependency; orb params come back from `orbParamsFor`.
type OrbParams = ReturnType<typeof orbParamsFor>;

// `AiCatalog.docUrl` is `string | undefined`, which does not fit `CatalogView`'s
// `docUrl?: string` under exactOptionalPropertyTypes.
function catalogViewOf(catalog: AiCatalog | null): CatalogView | null {
  if (catalog === null) return null;
  return {
    providers: catalog.providers.map((p) => ({ id: p.id, name: p.name, docUrl: p.docUrl ?? '' })),
  };
}

// The connections client `checkKey` drives.
const KEY_CHECK_API: KeyCheckApi = {
  createConnection,
  testConnection,
  replaceConnectionKey,
  deleteConnection,
};

const isComputerMode = (value: string): value is AiComputerMode =>
  (COMPUTER_MODES as readonly string[]).includes(value);

const isTemplate = (value: string): value is AiTemplateId =>
  (TEMPLATES as readonly string[]).includes(value);

// A failure with no status never reached the server, so the fixed fallback shows.
function describeFailure(failure: ApiFailure, fallback: string): AiErrorInfo {
  if (failure.status === 0) return { message: fallback, unavailable: false };
  return describeAiError(
    new ApiError(failure.status, failure.code, failure.message, failure.detail),
    fallback,
  );
}

export interface NewAiFlowOptions {
  onClose: () => void;
  /** Called with the created AI once the create call succeeded. */
  onCreated: (created: PublicAi) => void;
}

/** The New AI wizard's state and actions, shared by the shell and the four steps. */
export function useNewAiFlow({ onClose, onCreated }: NewAiFlowOptions) {
  const toast = useToast();
  const [connectionsResult] = useQuery(() => fromApi(() => listConnections()), []);
  const [catalogResult] = useQuery(() => fromApi(() => getAiCatalog()), []);
  const [optionsResult] = useQuery(() => fromApi(() => getComputerOptions()), []);
  const [machinesResult] = useQuery(() => fromApi(() => listMachines()), []);
  const connections = AsyncResult.isSuccess(connectionsResult) ? connectionsResult.value : [];
  const catalog = AsyncResult.isSuccess(catalogResult) ? catalogResult.value : null;
  const catalogView = catalogViewOf(catalog);
  const cloudAvailable = AsyncResult.isSuccess(optionsResult) ? optionsResult.value.cloud : false;
  const machines: Machine[] = AsyncResult.isSuccess(machinesResult) ? machinesResult.value : [];
  const [step, setStep] = useState(0);
  const [providerId, setProviderId] = useState<string | null>(null);
  const [baseUrl, setBaseUrl] = useState('');
  const [compatibleName, setCompatibleName] = useState('');
  const [key, setKeyValue] = useState('');
  const [keyState, setKeyState] = useState<KeyCheckState>({
    connectionId: null,
    created: false,
    verified: false,
  });
  const [keyError, setKeyError] = useState('');
  const [usingSavedKey, setUsingSavedKey] = useState(false);
  const [name, setName] = useState('');
  const [template, setTemplateValue] = useState<AiTemplateId>('dev');
  const [modelDraft, setModelDraft] = useState<string | null>(null);
  const [orbParams, setOrbParams] = useState<OrbParams | null>(null);
  const [computerMode, setComputerModeValue] = useState<AiComputerMode>('off');
  const [machineId, setMachineIdValue] = useState<string | null>(null);
  const [day, setDay] = useState('');
  const [month, setMonth] = useState('');
  // The in-flight key check's promise: `close` abandons it; an edit drops it.
  const pendingCheck = useRef<Promise<KeyCheckResult> | null>(null);
  const choices = providerChoices(catalogView, connections);
  const isCompatible = providerId === 'openai-compatible';
  const catalogModels: readonly AiCatalogModel[] =
    catalog?.providers.find((provider) => provider.id === providerId)?.models ?? [];

  const model =
    modelDraft ?? (defaultCatalogModelId(catalogModels) || defaultModelFor(providerId ?? ''));
  const modelOptions =
    catalogModels.length > 0
      ? catalogModels.map((entry) => ({ value: entry.id, label: entry.name }))
      : modelSuggestionsFor(providerId ?? '').map((id) => ({ value: id, label: id }));

  const limits = validateLimits(day, month);
  const connectionId = keyState.verified ? keyState.connectionId : null;
  const needsMachine = computerMode === 'runner' || computerMode === 'auto';
  const machineReady = !needsMachine || machineId !== null;
  const providerReady =
    providerId !== null &&
    (!isCompatible || (baseUrl.trim() !== '' && compatibleName.trim() !== ''));
  const canCreate =
    connectionId !== null &&
    name.trim() !== '' &&
    model.trim() !== '' &&
    limits.limits !== null &&
    machineReady;
  const canContinue =
    step === 0
      ? providerReady
      : step === 1
        ? keyState.verified || key.trim() !== ''
        : step === 2
          ? name.trim() !== '' && model.trim() !== ''
          : canCreate;

  const [checkState, runCheck] = useAction<KeyCheckInput, KeyCheckResult, never>((input) => {
    const pending = (pendingCheck.current = checkKey(KEY_CHECK_API, keyState, input));
    return Effect.promise(() => pending).pipe(
      Effect.tap((result) =>
        Effect.sync(() => {
          // A newer check, provider switch or close cleared the ref: drop it.
          if (pendingCheck.current !== pending) {
            void abandonKeyCheck(KEY_CHECK_API, result);
            return;
          }
          pendingCheck.current = null;
          setKeyState(result);
          if (result.verified) {
            setKeyError('');
            setStep(2);
          } else {
            setKeyError(result.message ?? 'Could not check the key. Try again.');
          }
        }),
      ),
    );
  });

  const [createState, create] = useAction<void, void, ApiFailure>(() => {
    const body = buildCreateBody(
      {
        name,
        template,
        persona: defaultPersonaFor(template),
        personaTouched: false,
        providerConnectionId: connectionId,
        model,
      },
      limits.limits,
    );
    if (body === null || connectionId === null || limits.limits === null) {
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

  const chooseProvider = (id: string): void => {
    setProviderId(id);
    const saved =
      connections
        .filter((connection) => connection.provider === id && connection.status === 'active')
        .sort((left, right) => right.createdAt.localeCompare(left.createdAt))[0] ?? null;
    setUsingSavedKey(saved !== null);
    setKeyValue('');
    setKeyError('');
    setKeyState({ connectionId: saved?.id ?? null, created: false, verified: saved !== null });
    pendingCheck.current = null;
    // Leaving the provider abandons an unverified connection its check created.
    void abandonKeyCheck(KEY_CHECK_API, keyState);
    setModelDraft(null);
  };

  const setKey = (value: string): void => {
    pendingCheck.current = null;
    // Editing the key drops any verified connection; the next Continue re-checks it.
    setKeyState((current) =>
      usingSavedKey
        ? { connectionId: null, created: false, verified: false }
        : { ...current, verified: false },
    );
    setUsingSavedKey(false);
    setKeyValue(value);
    setKeyError('');
  };

  // The base URL and the name are fixed when the connection is created, so an
  // edit needs a fresh connection (a replace would keep the old endpoint).
  const editCompatible = (apply: () => void): void => {
    apply();
    pendingCheck.current = null;
    // The endpoint is fixed when the connection is made, so the old row is abandoned.
    void abandonKeyCheck(KEY_CHECK_API, keyState);
    setKeyState({ connectionId: null, created: false, verified: false });
    setKeyError('');
  };

  const continueKey = (): void => {
    if (keyState.verified) {
      setStep(2);
      return;
    }
    if (key.trim() === '') {
      return;
    }
    setKeyError('');
    runCheck({
      provider: providerId ?? '',
      key: key.trim(),
      ...(isCompatible ? { baseUrl: baseUrl.trim(), label: compatibleName.trim() } : {}),
    });
  };

  const primary = (): void => {
    if (step === 1) {
      continueKey();
    } else if (step === 3) {
      create();
    } else if (canContinue) {
      setStep(step + 1);
    }
  };

  const close = (): void => {
    const pending = pendingCheck.current;
    pendingCheck.current = null;
    void abandonKeyCheck(KEY_CHECK_API, keyState);
    // The check may still create (or already created) a connection; abandon its
    // resolved state too, so nothing is left behind with a live key.
    if (pending !== null) void pending.then((result) => abandonKeyCheck(KEY_CHECK_API, result));
    onClose();
  };

  const providerText = choices.find((choice) => choice.id === providerId)?.label ?? '';
  const modelName = catalogModels.find((entry) => entry.id === model)?.name ?? model;
  const modelLabel =
    providerText !== '' && modelName.startsWith(`${providerText} `)
      ? modelName.slice(providerText.length + 1)
      : modelName;
  const createFailure = failureOf(createState);

  return {
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
    primaryLabel: isWaiting(checkState) ? 'Checking…' : step === 3 ? 'Create AI' : 'Continue',
    primaryDisabled: isWaiting(createState) || isWaiting(checkState) || !canContinue,
    busy: isWaiting(createState),
    error:
      createFailure === undefined
        ? ''
        : describeFailure(createFailure, 'Could not create the AI').message,
    close,
    providerChoices: choices,
    providerId,
    chooseProvider,
    isCompatible,
    baseUrl,
    setBaseUrl: (value: string) => editCompatible(() => setBaseUrl(value)),
    compatibleName,
    setCompatibleName: (value: string) => editCompatible(() => setCompatibleName(value)),
    baseUrlReachable: isCompatible && keyState.verified,
    key,
    setKey,
    keyVerified: keyState.verified,
    keyError,
    keyPlaceholder:
      keyState.verified && key === '' ? 'Saved key' : keyPlaceholderFor(providerId ?? ''),
    keyPage: providerId === null ? null : keyPageFor(providerId, catalogView),
    checkingKey: isWaiting(checkState),
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

/** The value `useNewAiFlow` returns, shared by the shell and the four steps. */
export type NewAiFlow = ReturnType<typeof useNewAiFlow>;
