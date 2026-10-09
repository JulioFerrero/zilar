import { Effect } from 'effect';
import { AsyncResult } from 'effect/reactivity';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, View } from 'react-native';

import { RequireAisAuth } from '@/components/ais/require-ais-auth';
import { describeAisError } from '@/components/ais/errors';
import { buildPatch } from '@/components/ais/form';
import { LimitsFields } from '@/components/ais/limits-fields';
import { validateLimits } from '@/components/ais/limits';
import { MachinePicker } from '@/components/ais/machine-picker';
import { ModelPicker } from '@/components/ais/model-picker';
import { ProviderPicker } from '@/components/ais/provider-picker';
import { RoutinesSection } from '@/components/ais/routines-section';
import { AiActivity } from '@/components/ais/ai-activity';
import { AiMemorySection } from '@/components/ais/ai-memory-section';
import { ToolsSection } from '@/components/ais/tools-section';
import { useToolsApi } from '@/components/ais/use-tools-api';
import { useAuditApi } from '@/components/ais/use-audit-api';
import { useAiMemoryApi } from '@/components/ais/use-ai-memory-api';
import { defaultModelFor } from '@/components/ais/models';
import { AisScreenShell } from '@/components/ais/screen-shell';
import { useAisApi } from '@/components/ais/use-ais-api';
import { useConnectionsApi } from '@/components/connections/use-connections-api';
import { applyMachineChange } from '@/components/machines/machine-change';
import { useMachinesApi } from '@/components/machines/use-machines-api';
import { Button } from '@/components/ui/button';
import { StateMessage } from '@/components/ui/state-message';
import { Text } from '@/components/ui/text';
import { TextField } from '@/components/ui/text-field';
import type { Connection as AisConnection, PublicAi, UpdateAiInput } from '@/lib/ais-api';
import type { Machine } from '@/lib/machines-api';
import { failureOf, isWaiting, useAction } from '@/lib/effect/use-action';
import { useQuery } from '@/lib/effect/use-query';

// The raw rejection is kept, not mapped, so describeAisError and the machine
// helper still see their own error classes.
function rawCall<A>(call: () => Promise<A>) {
  return Effect.tryPromise({ try: call, catch: (cause) => ({ cause }) });
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
  const { api } = useAisApi();
  const { api: connectionsApi } = useConnectionsApi();
  const { api: machinesApi } = useMachinesApi();
  const { api: toolsApi } = useToolsApi();
  const { api: auditApi } = useAuditApi();
  const { api: memoryApi } = useAiMemoryApi();
  const params = useLocalSearchParams<{ id: string }>();
  const id = typeof params.id === 'string' ? params.id : '';

  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [loaded, setLoaded] = useState<PublicAi | null>(null);
  const [loadError, setLoadError] = useState('');

  const [name, setName] = useState('');
  const [persona, setPersona] = useState('');
  const [day, setDay] = useState('2');
  const [month, setMonth] = useState('20');
  // The connection and machine pickers (mirror web `AiPanel`): the active
  // connections and the owner's machines, loaded beside the AI so a failure
  // here never blocks the rest of the screen.
  const [connections, setConnections] = useState<AisConnection[]>([]);
  const [selectedConnectionId, setSelectedConnectionId] = useState<string | null>(null);
  const [modelDraft, setModelDraft] = useState('');
  const [machines, setMachines] = useState<Machine[]>([]);
  const [machinesLoaded, setMachinesLoaded] = useState(false);
  // The AI's home machine, kept in local state so a successful change shows
  // at once and a failed one restores the previous value. Set from the
  // loaded AI, then from each PUT answer (the server is the source of truth).
  const [homeMachineId, setHomeMachineId] = useState<string | null>(null);
  const [machineError, setMachineError] = useState('');

  // Shows the AI the list answered with; an AI missing from the list is a
  // load error. The form fills from it once per load.
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
    setDay(String(ai.limits.perDayUsd));
    setMonth(String(ai.limits.perMonthUsd));
    setSelectedConnectionId(ai.providerConnectionId);
    setModelDraft(ai.model);
    setHomeMachineId(ai.machineId ?? null);
    setStatus('ready');
  };

  // The AI loads on mount and again on Retry, through the same query.
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
      rawCall(() => connectionsApi.listConnections()).pipe(
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
    [connectionsApi],
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

  // Sets or clears the AI's home machine through the separate machine route,
  // exactly like web `AiPanel`. The helper never rejects: on failure it hands
  // back the previous value and a fixed error sentence, and the PUT answer is
  // the source of truth on success.
  const [machineChange, runMachineChange] = useAction(
    (change: { aiId: string; next: string | null; previous: string | null }) =>
      Effect.promise(() =>
        applyMachineChange(machinesApi, change.aiId, change.next, change.previous),
      ).pipe(
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
  // The button stays on "Saving…" after a success, until the route leaves.
  const saving = isWaiting(saveState) || AsyncResult.isSuccess(saveState);
  const saveFailure = isWaiting(saveState) ? undefined : failureOf(saveState);
  const error =
    saveFailure === undefined
      ? ''
      : describeAisError(saveFailure.cause, 'Could not update the AI').message;

  const limits = validateLimits(day, month);
  const canSave = loaded !== null && name.trim() !== '' && limits.limits !== null && !saving;

  // Switching provider re-prefills that provider's default model, as in the
  // create wizard: the old model name rarely fits the new provider.
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
    // The model and connection diffs ride the same patch, like web
    // `AiPanel`: the server needs the model whenever the connection
    // changes, so a connection change always carries both, while a
    // model-only change carries just the model. `UpdateAiInput` predates
    // those two fields, so they ride an extension the PATCH body keeps.
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
    <KeyboardAvoidingView
      className="flex-1"
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <AisScreenShell
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
      </AisScreenShell>
    </KeyboardAvoidingView>
  );
}
