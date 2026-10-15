// effect-plain: the New AI wizard is plain React state; its async is the shared key-check and create calls over the injected promise APIs, the same promise-edge adapter shape the AI screens already use.
import type { AiCatalog } from '@zilar/api-contract';
import {
  checkKey,
  clampOrbLight,
  defaultCatalogModelId,
  defaultModelFor,
  defaultPersonaFor,
  isLlmProvider,
  keyPageFor,
  keyPlaceholderFor,
  modelSuggestionsFor,
  orbParamsFor,
  providerChoices,
  shuffleOrb,
  validateLimits,
  type AiTemplateId,
  type KeyCheckState,
} from '@zilar/chat-core';
import { useEffect, useMemo, useRef, useState } from 'react';

import type { ComputerMode } from '@/components/ais/computer-picker';
import { describeAisError } from '@/components/ais/errors';
import {
  EMPTY_KEY_STATE,
  buildCreateInput,
  discardCreatedKey,
  keyCheckBaseState,
  keyStateAfterBaseUrlEdit,
  settleNewAiKeyCheck,
  type WizardForm,
} from '@/components/ais/form';
import { useAisApi } from '@/components/ais/use-ais-api';
import { useConnectionsApi } from '@/components/connections/use-connections-api';
import { applyMachineChange } from '@/components/machines/machine-change';
import { useMachinesApi } from '@/components/machines/use-machines-api';
import type { SelectSheetOption } from '@/components/ui/select-sheet';
import { AisApiError, type Connection, type PublicAi } from '@/lib/ais-api';
import type { Machine } from '@/lib/machines-api';

import { saveOrbAvatar } from './orb-upload';

export type NewAiStep = 'provider' | 'key' | 'model' | 'setup';

export type OrbParams = ReturnType<typeof orbParamsFor>;

function newestConnection(connections: readonly Connection[], provider: string): Connection | null {
  const mine = connections.filter((connection) => connection.provider === provider);
  return mine.reduce<Connection | null>(
    (best, next) => (best !== null && best.createdAt > next.createdAt ? best : next),
    null,
  );
}

/** T-1445: a pick clears Base URL/Name; OpenAI-compatible never reuses a saved key. */
export function providerSelection(connections: readonly Connection[], provider: string) {
  const saved = provider === 'openai-compatible' ? null : newestConnection(connections, provider);
  const keyState =
    saved === null ? EMPTY_KEY_STATE : { connectionId: saved.id, created: false, verified: true };
  return { keyState, baseUrl: '', connectionName: '' };
}

/** T-1445: the flow's state and actions; the sheet and its steps stay thin. */
export function useNewAiFlow({
  onCreated,
}: {
  onCreated: (ai: PublicAi, partialFailure: boolean) => void;
}) {
  const { api } = useAisApi();
  const { api: connectionsApi } = useConnectionsApi();
  const { api: machinesApi } = useMachinesApi();

  const [step, setStep] = useState<NewAiStep>('provider');
  const [orbOpen, setOrbOpen] = useState(false);
  const [providerId, setProviderId] = useState<string | null>(null);
  const [baseUrl, setBaseUrl] = useState('');
  const [connectionName, setConnectionName] = useState('');
  const [providerError, setProviderError] = useState('');
  const [keyValue, setKeyValue] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [keyState, setKeyStateState] = useState<KeyCheckState>(EMPTY_KEY_STATE);
  const keyStateRef = useRef(keyState);
  function setKeyState(next: KeyCheckState): void {
    keyStateRef.current = next;
    setKeyStateState(next);
  }
  const [keyMessage, setKeyMessage] = useState('');
  const [checking, setChecking] = useState(false);
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
  const [connections, setConnections] = useState<Connection[]>([]);
  const [catalog, setCatalog] = useState<AiCatalog | null>(null);
  const [machines, setMachines] = useState<Machine[]>([]);
  const [cloud, setCloud] = useState(false);
  const checkToken = useRef(0);
  const createRef = useRef(false);
  const keyCheckRef = useRef(false);
  const closedRef = useRef(false);

  useEffect(() => {
    let active = true;
    void (async () => {
      const [listed, catalogResult, options, machineList] = await Promise.allSettled([
        api.listConnections(),
        api.getAiCatalog(),
        api.getComputerOptions(),
        machinesApi.listMachines(),
      ]);
      if (!active) return;
      if (listed.status === 'fulfilled') {
        const rows = listed.value.filter((c) => c.status === 'active' && isLlmProvider(c.provider));
        setConnections(rows);
      }
      if (catalogResult.status === 'fulfilled') setCatalog(catalogResult.value);
      if (options.status === 'fulfilled') setCloud(options.value.cloud);
      if (machineList.status === 'fulfilled') {
        setMachines(machineList.value.filter((machine) => machine.status === 'approved'));
      }
    })();
    return () => {
      active = false;
      checkToken.current += 1;
      closedRef.current = true;
      if (!createRef.current) void discardCreatedKey(connectionsApi, keyStateRef.current);
    };
  }, [api, connectionsApi, machinesApi]);

  const limits = validateLimits(day, month);
  const choices = useMemo(() => providerChoices(catalog, connections), [catalog, connections]);
  const catalogModels = useMemo(() => {
    const provider = catalog?.providers.find((entry) => entry.id === providerId);
    return provider?.models ?? [];
  }, [catalog, providerId]);
  const modelOptions: SelectSheetOption[] =
    catalogModels.length > 0
      ? catalogModels.map((entry) => ({ value: entry.id, label: entry.name }))
      : modelSuggestionsFor(providerId ?? '').map((value) => ({ value, label: value }));
  const isCompatible = providerId === 'openai-compatible';
  const orbParams = orbEdited && orb !== null ? orb : orbParamsFor(name.trim() || 'ai');

  function selectProvider(id: string): void {
    // T-1445: a switch drops our old connection (verified deleted, unverified abandoned)
    // and stales an in-flight check.
    checkToken.current += 1;
    setChecking(false);
    void discardCreatedKey(connectionsApi, keyState);
    const picked = providerSelection(connections, id);
    setProviderId(id);
    setProviderError('');
    setKeyValue('');
    setShowKey(false);
    setKeyMessage('');
    setModel('');
    setBaseUrl(picked.baseUrl);
    setConnectionName(picked.connectionName);
    setKeyState(picked.keyState);
  }

  function goToModel(): void {
    const fallback =
      (catalogModels.length > 0 ? defaultCatalogModelId(catalogModels) : '') ||
      defaultModelFor(providerId ?? '');
    if (model.trim() === '' && fallback !== '') setModel(fallback);
    setStep('model');
  }

  function advance(): void {
    setError('');
    if (step === 'provider') {
      if (providerId === null) return;
      if (isCompatible && (baseUrl.trim() === '' || connectionName.trim() === '')) {
        setProviderError(baseUrl.trim() === '' ? 'Enter a base URL.' : 'Enter a name.');
        return;
      }
      setStep('key');
      return;
    }
    if (step === 'key') {
      if (keyState.verified && keyValue.trim() === '') {
        goToModel();
        return;
      }
      if (keyValue.trim() === '' || checking) {
        setKeyMessage('Paste your key.');
        return;
      }
      if (keyCheckRef.current) return;
      keyCheckRef.current = true;
      setChecking(true);
      setKeyMessage('');
      const token = checkToken.current + 1;
      checkToken.current = token;
      void (async () => {
        const result = await checkKey(connectionsApi, keyCheckBaseState(keyValue, keyState), {
          provider: providerId ?? '',
          key: keyValue.trim(),
          ...(connectionName.trim() === '' ? {} : { label: connectionName.trim() }),
          ...(isCompatible ? { baseUrl: baseUrl.trim() } : {}),
        });
        if (!(await settleNewAiKeyCheck(connectionsApi, token, checkToken.current, result))) return;
        setChecking(false);
        setKeyState(result);
        if (result.verified) {
          setKeyValue('');
          setShowKey(false);
          goToModel();
        } else {
          setKeyMessage(result.message ?? 'Could not check the key. Try again.');
        }
      })().finally(() => {
        keyCheckRef.current = false;
      });
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
      providerConnectionId: keyState.connectionId,
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
    setCreating(true);
    setError('');
    void (async () => {
      let ai: PublicAi;
      try {
        ai = await api.createAi(input);
      } catch (cause) {
        setCreating(false);
        const fixed = 'Could not create the AI.';
        setError(cause instanceof AisApiError ? describeAisError(cause, fixed).message : fixed);
        // A close during the POST left the key to this create: it failed, so drop it.
        if (closedRef.current) void discardCreatedKey(connectionsApi, keyStateRef.current);
        return;
      }
      // The connection is now the AI's, so closing must not delete it.
      setKeyState(EMPTY_KEY_STATE);
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
    if (checking) return;
    if (value === 'provider' && step !== 'provider') setStep('provider');
    else if (value === 'key' && (step === 'model' || step === 'setup')) setStep('key');
    else if (value === 'model' && step === 'setup') setStep('model');
  }

  function markOrb(next: OrbParams): void {
    setOrb(next);
    setOrbEdited(true);
  }

  // T-1445: a Base URL or Name edit drops our connection for the old endpoint and starts
  // the key over empty; a saved key (`created: false`) is left to the user.
  function editEndpoint(set: (value: string) => void, value: string): void {
    set(value);
    void discardCreatedKey(connectionsApi, keyState);
    setKeyState(keyStateAfterBaseUrlEdit(keyState));
  }

  const needsMachine = (computer === 'runner' || computer === 'auto') && machineId === null;
  const primaryDisabled =
    checking ||
    creating ||
    (step === 'provider' && providerId === null) ||
    (step === 'key' && !keyState.verified && keyValue.trim() === '') ||
    (step === 'model' && (name.trim() === '' || model.trim() === '')) ||
    (step === 'setup' && (limits.limits === null || needsMachine));

  return {
    step,
    goToStep,
    back,
    primaryLabel:
      step === 'setup'
        ? creating
          ? 'Creating…'
          : 'Create AI'
        : checking
          ? 'Checking…'
          : 'Continue',
    primaryDisabled,
    busy: checking || creating,
    advance,
    create,
    error,
    abandon: (): void => {
      checkToken.current += 1;
      closedRef.current = true;
      if (!createRef.current) void discardCreatedKey(connectionsApi, keyStateRef.current);
    },
    orbOpen,
    openOrb: () => setOrbOpen(true),
    closeOrb: () => setOrbOpen(false),
    providerChoices: choices,
    providerId,
    selectProvider,
    isCompatible,
    baseUrl,
    setBaseUrl: (value: string) => editEndpoint(setBaseUrl, value),
    connectionName,
    setConnectionName: (value: string) => editEndpoint(setConnectionName, value),
    providerError,
    keyValue,
    setKeyValue,
    showKey,
    toggleShowKey: () => setShowKey((previous) => !previous),
    keyMessage,
    keyPlaceholder: keyState.verified ? 'Saved key' : keyPlaceholderFor(providerId ?? ''),
    keyPageUrl: providerId === null ? null : keyPageFor(providerId, catalog),
    keyVerified: keyState.verified,
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
