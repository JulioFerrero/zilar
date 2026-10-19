import { Effect } from 'effect';
import { AsyncResult } from 'effect/reactivity';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState, useMemo } from 'react';
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';
import { View } from 'react-native';

import { RequireAisAuth } from '@/components/ais/require-ais-auth';
import { describeAisError } from '@/components/ais/errors';
import { describeMachinesError } from '@/components/machines/errors';
import { LimitsFields } from '@/components/ais/limits-fields';
import { RoutinesSection } from '@/components/ais/routines-section';
import { AiActivity } from '@/components/ais/ai-activity';
import { AiMemorySection } from '@/components/ais/ai-memory-section';
import { ToolsSection } from '@/components/ais/tools-section';

import { useApi } from '@/lib/use-mockable-api';
import {
  defaultModelFor,
  validateLimits,
  isLlmProvider,
  providerLabel,
  formatContextTokens,
  formatModelPrices,
  modelSuggestionsFor,
  buildPatch,
  computerChoices,
} from '@zilar/chat-core';
import { SettingsScreenShell } from '@/components/settings/screen-shell';
import {
  makeAisApi,
  makeAuditApi,
  makeChatExtrasApi,
  makeMachinesApi,
  makeToolsApi,
  type Connection,
  type PublicAi,
  type UpdateAiInput,
  failureOf,
} from '@zilar/client-core';
import { rawCall } from '@/components/chat/group-action';
import { Button } from '@/components/ui/button';
import { StateMessage } from '@/components/ui/state-message';
import { Text, TextField } from '@/components/ui/text';
import { isWaiting, useAction } from '@/lib/effect/use-action';
import { useQuery } from '@/lib/effect/use-query';
import { OptionGlyph, OptionRow } from '../../components/ais/option-row';
import { Cloud, Laptop, PowerOff, Sparkles, Wrench, type LucideIcon } from 'lucide-react-native';
import type { AiCatalogModel, Machine } from '@zilar/api-contract';
import { ACCENT, ACCENT_FOREGROUND } from '@/lib/colors';
import type { ComputerMode } from '@zilar/chat-core';
import { runMobile } from '@/lib/effect/runtime';
import { cn } from '@/lib/utils';

function ModelPicker({
  provider,
  value,
  onChange,
  models = [],
}: {
  provider: string;
  value: string;
  onChange: (model: string) => void;
  models?: readonly AiCatalogModel[];
}) {
  const [query, setQuery] = useState('');
  const suggestions = modelSuggestionsFor(provider);

  const filtered = useMemo(() => {
    const term = query.trim().toLowerCase();
    if (term === '') {
      return models;
    }
    return models.filter((model) => `${model.name} ${model.id}`.toLowerCase().includes(term));
  }, [models, query]);

  return (
    <View className="gap-3">
      <View className="gap-1">
        <Text className="text-[14px] font-medium text-foreground">Model</Text>
        <TextField
          value={value}
          onChangeText={onChange}
          accessibilityLabel="Model"
          placeholder={`${providerLabel(provider)} model name`}
          maxLength={256}
          autoCapitalize="none"
          autoCorrect={false}
          className="py-2.5"
        />
      </View>

      {models.length > 0 ? (
        <View className="gap-2">
          <TextField
            value={query}
            onChangeText={setQuery}
            accessibilityLabel="Search models"
            placeholder="Search models"
            maxLength={64}
            autoCapitalize="none"
            autoCorrect={false}
            className="py-2.5"
          />
          {filtered.length === 0 ? (
            <Text className="text-[13px] text-muted-foreground">No models match your search.</Text>
          ) : (
            filtered.map((model) => (
              <OptionRow
                key={model.id}
                selected={value === model.id}
                accessibilityLabel={model.name}
                onPress={() => onChange(model.id)}
                className="py-2.5"
              >
                <View className="min-w-0 flex-1 gap-0.5">
                  <Text className="text-[15px] text-foreground">{model.name}</Text>
                  <Text className="text-[12px] text-muted-foreground">
                    {formatContextTokens(model.contextTokens)} ·{' '}
                    {formatModelPrices(model.inputPricePerMTok, model.outputPricePerMTok)}
                  </Text>
                </View>
                {model.toolCalls ? (
                  <View className="flex-row items-center gap-1 rounded-full border border-divider px-1.5 py-0.5">
                    <Wrench size={11} color={ACCENT} />
                    <Text className="text-[11px] text-muted-foreground">tools</Text>
                  </View>
                ) : null}
              </OptionRow>
            ))
          )}
        </View>
      ) : suggestions.length > 0 ? (
        <View className="gap-2">
          <Text className="text-[13px] text-muted-foreground">Suggestions</Text>
          {suggestions.map((model) => (
            <OptionRow
              key={model}
              selected={value === model}
              accessibilityLabel={model}
              onPress={() => onChange(model)}
              className="py-2.5"
            >
              <Text className="text-[15px] text-foreground">{model}</Text>
            </OptionRow>
          ))}
        </View>
      ) : null}
    </View>
  );
}

/**
 * The owner's approved machines plus "The platform (no machine)". The current value always shows, even when the machine is gone, so the picker never silently switches the AI to the platform.
 */
function MachinePicker({
  machines,
  loaded,
  value,
  disabled,
  onChange,
}: {
  machines: readonly Machine[];
  loaded: boolean;
  value: string | null;
  disabled?: boolean;
  onChange: (id: string | null) => void;
}) {
  const approved = machines.filter((machine) => machine.status === 'approved');
  const knownIds = new Set(approved.map((machine) => machine.id));
  const currentUnknown = value !== null && !knownIds.has(value);

  return (
    <View className="gap-2">
      {loaded ? (
        <OptionRow
          selected={value === null}
          disabled={disabled}
          accessibilityLabel="The platform (no machine)"
          onPress={() => onChange(null)}
        >
          <OptionGlyph label="Platform" selected={value === null} />
          <View className="min-w-0 flex-1">
            <Text className="text-[15px] font-medium text-foreground">
              The platform (no machine)
            </Text>
            <Text numberOfLines={1} className="text-[13px] text-muted-foreground">
              The AI runs on the shared platform
            </Text>
          </View>
        </OptionRow>
      ) : null}
      {approved.map((machine) => {
        const selected = machine.id === value;
        return (
          <OptionRow
            key={machine.id}
            selected={selected}
            disabled={disabled}
            accessibilityLabel={machine.name}
            onPress={() => onChange(machine.id)}
          >
            <OptionGlyph label={machine.name} selected={selected} />
            <View className="min-w-0 flex-1">
              <Text className="text-[15px] font-medium text-foreground">{machine.name}</Text>
              <Text numberOfLines={1} className="text-[13px] text-muted-foreground">
                {machine.os} {machine.osVersion} · {machine.arch}
              </Text>
            </View>
          </OptionRow>
        );
      })}
      {currentUnknown ? (
        <OptionRow
          selected
          disabled
          accessibilityLabel={'Current machine (unavailable)'}
          onPress={() => {}}
        >
          <OptionGlyph label="?" selected />
          <View className="min-w-0 flex-1">
            <Text className="text-[15px] font-medium text-foreground">
              Current machine (unavailable)
            </Text>
            <Text numberOfLines={1} className="text-[13px] text-muted-foreground">
              It was revoked or removed elsewhere
            </Text>
          </View>
        </OptionRow>
      ) : null}
    </View>
  );
}

interface ComputerModeControls {
  mode: ComputerMode;
  cloud: boolean;
  error: string;
  busy: boolean;
  adopt: (ai: PublicAi) => void;
  change: (mode: ComputerMode) => void;
}

function useComputerMode(
  api: ReturnType<typeof makeAisApi>,
  aiId: string | null,
): ComputerModeControls {
  const [mode, setMode] = useState<ComputerMode>('off');
  const [error, setError] = useState('');
  // A failed options read keeps the cloud option disabled, the safe default.
  const [cloud, setCloud] = useState(false);

  useQuery(
    () =>
      rawCall(() => api.getComputerOptions()).pipe(
        Effect.tap((options) => Effect.sync(() => setCloud(options.cloud))),
        Effect.catch(() => Effect.sync(() => setCloud(false))),
      ),
    [api],
  );

  const [state, run] = useAction((change: { next: ComputerMode; previous: ComputerMode }) => {
    if (aiId === null || change.next === change.previous) {
      return Effect.void;
    }
    return Effect.sync(() => {
      setMode(change.next);
      setError('');
    }).pipe(
      Effect.andThen(rawCall(() => api.updateAi(aiId, { computerMode: change.next }))),
      Effect.tap((fresh) => Effect.sync(() => setMode(fresh.computerMode ?? 'off'))),
      Effect.asVoid,
      Effect.catch(({ cause }) =>
        Effect.sync(() => {
          setMode(change.previous);
          setError(describeAisError(cause, 'Could not update the computer.').message);
        }),
      ),
    );
  });
  const busy = isWaiting(state);

  const change = (next: ComputerMode): void => {
    if (aiId === null || busy) {
      return;
    }
    run({ next, previous: mode });
  };

  const adopt = (ai: PublicAi): void => {
    setMode(ai.computerMode ?? 'off');
  };

  return { mode, cloud, error, busy, adopt, change };
}

/** A connection whose provider is not an LLM one (GitHub) is dropped: it cannot run an AI. */
function ProviderPicker({
  connections,
  value,
  onChange,
}: {
  connections: readonly Connection[];
  value: string | null;
  onChange: (id: string) => void;
}) {
  return (
    <View className="gap-2">
      {connections
        .filter((connection) => isLlmProvider(connection.provider))
        .map((connection) => {
          const selected = connection.id === value;
          const label = providerLabel(connection.provider);
          return (
            <OptionRow
              key={connection.id}
              selected={selected}
              accessibilityLabel={label}
              onPress={() => onChange(connection.id)}
            >
              <OptionGlyph label={label} selected={selected} />
              <View className="min-w-0 flex-1">
                <Text className="text-[15px] font-medium text-foreground">{label}</Text>
                <Text numberOfLines={1} className="text-[13px] text-muted-foreground">
                  {connection.label ?? 'No label'}
                </Text>
              </View>
            </OptionRow>
          );
        })}
    </View>
  );
}

export default function EditAiScreen() {
  return (
    <RequireAisAuth>
      <EditAi />
    </RequireAisAuth>
  );
}

function EditAi() {
  const router = useRouter();
  const { api } = useApi(makeAisApi);
  const { api: machinesApi } = useApi(makeMachinesApi);
  const { api: toolsApi } = useApi(makeToolsApi);
  const { api: auditApi } = useApi(makeAuditApi);
  const { api: memoryApi } = useApi(makeChatExtrasApi);
  const params = useLocalSearchParams<{ id: string }>();
  const id = typeof params.id === 'string' ? params.id : '';

  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [loaded, setLoaded] = useState<PublicAi | null>(null);
  const [loadError, setLoadError] = useState('');

  const [name, setName] = useState('');
  const [persona, setPersona] = useState('');
  const [day, setDay] = useState('');
  const [month, setMonth] = useState('');
  const [connections, setConnections] = useState<Connection[]>([]);
  const [selectedConnectionId, setSelectedConnectionId] = useState<string | null>(null);
  const [modelDraft, setModelDraft] = useState('');
  const [machines, setMachines] = useState<Machine[]>([]);
  const [machinesLoaded, setMachinesLoaded] = useState(false);
  // The PUT answer is the source of truth; a failed change restores the previous value.
  const [homeMachineId, setHomeMachineId] = useState<string | null>(null);
  const [machineError, setMachineError] = useState('');

  const computer = useComputerMode(api, loaded?.id ?? null);

  const showAi = (list: PublicAi[]): void => {
    const ai = list.find((item) => item.id === id) ?? null;
    if (ai === null) {
      setLoadError('That AI no longer exists.');
      setStatus('error');
      return;
    }
    setLoaded(ai);
    setName(ai.name);
    setPersona(ai.persona);
    setDay(ai.limits.perDayUsd === null ? '' : String(ai.limits.perDayUsd));
    setMonth(ai.limits.perMonthUsd === null ? '' : String(ai.limits.perMonthUsd));
    setSelectedConnectionId(ai.providerConnectionId);
    setModelDraft(ai.model);
    setHomeMachineId(ai.machineId ?? null);
    computer.adopt(ai);
    setStatus('ready');
  };

  const [, reloadAi] = useQuery(
    () =>
      rawCall(() => api.listAis()).pipe(
        Effect.tap((list) => Effect.sync(() => showAi(list))),
        Effect.catch(({ cause }) =>
          Effect.sync(() => {
            setLoadError(describeAisError(cause, 'Could not load the AI').message);
            setStatus('error');
          }),
        ),
      ),
    [api, id],
  );

  useQuery(
    () =>
      rawCall(() => api.listConnections()).pipe(
        Effect.tap((list) =>
          Effect.sync(() => {
            setConnections(list.filter((connection) => connection.status === 'active'));
          }),
        ),
        Effect.catch(() =>
          Effect.sync(() => {
            setConnections([]);
          }),
        ),
      ),
    [api],
  );

  useQuery(
    () =>
      rawCall(() => machinesApi.listMachines()).pipe(
        Effect.tap((list) =>
          Effect.sync(() => {
            setMachines(list);
            setMachinesLoaded(true);
          }),
        ),
        Effect.catch(() =>
          Effect.sync(() => {
            setMachines([]);
            setMachinesLoaded(false);
          }),
        ),
      ),
    [machinesApi],
  );

  const retry = (): void => {
    setStatus('loading');
    reloadAi();
  };

  const [machineChange, runMachineChange] = useAction(
    (change: { aiId: string; next: string | null; previous: string | null }) =>
      Effect.promise(() => applyMachineChange(api, change.aiId, change.next, change.previous)).pipe(
        Effect.tap((outcome) =>
          Effect.sync(() => {
            setHomeMachineId(outcome.home);
            setMachineError(outcome.error);
          }),
        ),
      ),
  );
  const machineBusy = isWaiting(machineChange);

  const changeMachine = (machineId: string | null): void => {
    if (loaded === null || machineBusy) {
      return;
    }
    setMachineError('');
    runMachineChange({ aiId: loaded.id, next: machineId, previous: homeMachineId });
  };

  const [saveState, runSave] = useAction(
    (change: {
      aiId: string;
      patch: UpdateAiInput & { model?: string; providerConnectionId?: string };
    }) =>
      rawCall(() => api.updateAi(change.aiId, change.patch)).pipe(
        Effect.tap(() => Effect.sync(() => router.back())),
      ),
  );
  const saving = isWaiting(saveState) || AsyncResult.isSuccess(saveState);
  const saveFailure = isWaiting(saveState) ? undefined : failureOf(saveState);
  const error =
    saveFailure === undefined
      ? ''
      : describeAisError(saveFailure.cause, 'Could not update the AI').message;

  const limits = validateLimits(day, month);
  const canSave = loaded !== null && name.trim() !== '' && limits.limits !== null && !saving;

  // Switching provider re-prefills that provider's default model: the old model name rarely fits the new provider.
  const chooseConnection = (connectionId: string): void => {
    setSelectedConnectionId(connectionId);
    const next = connections.find((connection) => connection.id === connectionId) ?? null;
    if (next !== null) {
      setModelDraft(defaultModelFor(next.provider));
    }
  };

  const save = (): void => {
    if (loaded === null || saving) {
      return;
    }
    const base = buildPatch({
      name,
      originalName: loaded.name,
      persona,
      originalPersona: loaded.persona,
      limits: limits.limits,
      originalLimits: loaded.limits,
    });
    // A connection change always carries both fields because the server needs the model whenever the connection changes; a model-only change carries just the model.
    const modelTrimmed = modelDraft.trim();
    const modelChanged = modelTrimmed !== '' && modelTrimmed !== loaded.model;
    const connectionChanged =
      selectedConnectionId !== null && selectedConnectionId !== loaded.providerConnectionId;
    let patch: (UpdateAiInput & { model?: string; providerConnectionId?: string }) | null = base;
    if (connectionChanged || modelChanged) {
      patch = {
        ...(patch === null ? { model: modelTrimmed } : { ...patch, model: modelTrimmed }),
        ...(connectionChanged && selectedConnectionId !== null
          ? { providerConnectionId: selectedConnectionId }
          : {}),
      };
    }
    if (name.trim() === '' || limits.limits === null || patch === null) {
      return;
    }
    runSave({ aiId: loaded.id, patch });
  };

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior="padding">
      <SettingsScreenShell
        title={loaded === null ? 'Edit AI' : `Edit ${loaded.name}`}
        onBack={() => router.back()}
        scroll
        footer={
          <>
            <Button variant="ghost" disabled={saving} onPress={() => router.back()}>
              <Text>Cancel</Text>
            </Button>
            <Button className="flex-1" disabled={!canSave} onPress={save}>
              <Text>{saving ? 'Saving…' : 'Save'}</Text>
            </Button>
          </>
        }
      >
        {status === 'loading' ? (
          <StateMessage kind="loading" title="Loading…" />
        ) : status === 'error' ? (
          <StateMessage
            kind="error"
            title={loadError}
            action={{ label: 'Retry', onPress: retry }}
          />
        ) : (
          <View className="gap-4">
            <View className="gap-1">
              <Text className="text-[14px] font-medium text-foreground">Name</Text>
              <TextField
                value={name}
                onChangeText={setName}
                accessibilityLabel="Name"
                maxLength={64}
              />
            </View>

            <View className="gap-1">
              <Text className="text-[14px] font-medium text-foreground">Persona</Text>
              <TextField
                value={persona}
                onChangeText={setPersona}
                accessibilityLabel="Persona"
                multiline
                maxLength={4000}
                className="min-h-[150px]"
              />
            </View>

            <LimitsFields
              day={day}
              month={month}
              dayError={limits.dayError}
              monthError={limits.monthError}
              onDayChange={setDay}
              onMonthChange={setMonth}
            />

            <View className="gap-1">
              <Text className="text-[14px] font-medium text-foreground">Provider connection</Text>
              {connections.length === 0 ? (
                <Text className="text-[13px] text-muted-foreground">
                  No active connections. Add one under Settings → Connections.
                </Text>
              ) : (
                <ProviderPicker
                  connections={connections}
                  value={selectedConnectionId}
                  onChange={chooseConnection}
                />
              )}
            </View>

            {selectedConnectionId !== null ? (
              <ModelPicker
                provider={
                  connections.find((connection) => connection.id === selectedConnectionId)
                    ?.provider ?? ''
                }
                value={modelDraft}
                onChange={setModelDraft}
              />
            ) : null}

            <View className="gap-1">
              <Text className="text-[14px] font-medium text-foreground">Home machine</Text>
              <MachinePicker
                machines={machines}
                loaded={machinesLoaded}
                value={homeMachineId}
                disabled={machineBusy}
                onChange={changeMachine}
              />
              {machineError !== '' ? (
                <Text accessibilityRole="alert" className="text-[13px] text-danger">
                  {machineError}
                </Text>
              ) : null}
            </View>

            <ComputerPicker
              value={computer.mode}
              cloud={computer.cloud}
              hasMachine={homeMachineId !== null}
              disabled={computer.busy}
              error={computer.error}
              onChange={computer.change}
            />

            {loaded !== null ? (
              <AiMemorySection api={memoryApi} chat={loaded.jid} aiId={id} aiName={loaded.name} />
            ) : null}

            <ToolsSection api={toolsApi} aiId={id} />
            <RoutinesSection api={toolsApi} aiId={id} />
            <AiActivity api={auditApi} aiId={id} />

            {error !== '' ? (
              <Text accessibilityRole="alert" className="text-[14px] text-danger">
                {error}
              </Text>
            ) : null}
          </View>
        )}
      </SettingsScreenShell>
    </KeyboardAvoidingView>
  );
}

/**
 * The `changeMachine` flow behind the picker: the PUT answer is the shown machine; on failure the previous value is restored with a fixed sentence.
 */
function applyMachineChange(
  api: ReturnType<typeof makeAisApi>,
  aiId: string,
  next: string | null,
  previous: string | null,
): Promise<{ home: string | null; error: string }> {
  return runMobile(
    Effect.tryPromise({
      try: () => api.setAiMachine(aiId, next),
      catch: (cause: unknown) => cause,
    }).pipe(
      Effect.match({
        onSuccess: (fresh) => ({ home: fresh.machineId ?? null, error: '' }),
        onFailure: (cause) => ({
          home: previous,
          error: describeMachinesError(cause, 'Could not update the home machine.').message,
        }),
      }),
    ),
  );
}

const COMPUTER_ICONS: Record<ComputerMode, LucideIcon> = {
  off: PowerOff,
  cloud: Cloud,
  runner: Laptop,
  auto: Sparkles,
};

function ComputerPicker({
  value,
  cloud,
  hasMachine,
  disabled,
  error,
  onChange,
}: {
  value: ComputerMode;
  cloud: boolean;
  hasMachine: boolean;
  disabled?: boolean;
  error?: string;
  onChange: (mode: ComputerMode) => void;
}) {
  return (
    <View className="gap-2">
      <Text className="text-[14px] font-medium text-foreground">Computer</Text>
      {computerChoices(cloud, hasMachine).map((choice) => {
        const selected = choice.mode === value;
        const Icon = COMPUTER_ICONS[choice.mode];
        return (
          <OptionRow
            key={choice.mode}
            selected={selected}
            disabled={choice.disabled || disabled === true}
            accessibilityLabel={choice.label}
            onPress={() => onChange(choice.mode)}
          >
            <View
              className={cn(
                'h-9 w-9 shrink-0 items-center justify-center rounded-full',
                selected ? 'bg-accent' : 'bg-surface',
              )}
            >
              <Icon size={16} color={selected ? ACCENT_FOREGROUND : ACCENT} />
            </View>
            <View className="min-w-0 flex-1">
              <Text className="text-[15px] font-medium text-foreground">{choice.label}</Text>
              <Text numberOfLines={1} className="text-[13px] text-muted-foreground">
                {choice.description}
              </Text>
            </View>
          </OptionRow>
        );
      })}
      {error !== undefined && error !== '' ? (
        <Text accessibilityRole="alert" className="text-[13px] text-danger">
          {error}
        </Text>
      ) : null}
    </View>
  );
}
