import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Platform, TextInput, View } from 'react-native';
import { useColorScheme } from 'nativewind';

import { RequireAisAuth } from '@/components/ais/require-ais-auth';
import { describeAisError } from '@/components/ais/errors';
import { buildPatch } from '@/components/ais/form';
import { LimitsFields } from '@/components/ais/limits-fields';
import { validateLimits } from '@/components/ais/limits';
import { MachinePicker } from '@/components/ais/machine-picker';
import { ModelPicker } from '@/components/ais/model-picker';
import { ProviderPicker } from '@/components/ais/provider-picker';
import { defaultModelFor } from '@/components/ais/models';
import { AisScreenShell } from '@/components/ais/screen-shell';
import { useAisApi } from '@/components/ais/use-ais-api';
import { useConnectionsApi } from '@/components/connections/use-connections-api';
import { applyMachineChange } from '@/components/machines/machine-change';
import { useMachinesApi } from '@/components/machines/use-machines-api';
import { Button } from '@/components/ui/button';
import { Text } from '@/components/ui/text';
import { ACCENT } from '@/lib/colors';
import { asColorScheme } from '@/lib/color-scheme';
import type { Connection as AisConnection, PublicAi, UpdateAiInput } from '@/lib/ais-api';
import type { Machine } from '@/lib/machines-api';

export default function EditAiScreen() {
  return (
    <RequireAisAuth>
      <EditAi />
    </RequireAisAuth>
  );
}

function EditAi() {
  const router = useRouter();
  const scheme = asColorScheme(useColorScheme().colorScheme);
  const { api } = useAisApi();
  const { api: connectionsApi } = useConnectionsApi();
  const { api: machinesApi } = useMachinesApi();
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
  const [machineBusy, setMachineBusy] = useState(false);
  const [machineError, setMachineError] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  // Guards against a double tap landing before React re-renders the disabled
  // button, so one Save can never PATCH twice.
  const savingRef = useRef(false);

  const load = useCallback(() => {
    void api
      .listAis()
      .then((list) => {
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
      })
      .catch((cause: unknown) => {
        setLoadError(describeAisError(cause, 'Could not load the AI').message);
        setStatus('error');
      });
  }, [api, id]);

  useEffect(() => {
    connectionsApi
      .listConnections()
      .then((list) => {
        setConnections(list.filter((connection) => connection.status === 'active'));
      })
      .catch(() => {
        setConnections([]);
      });
  }, [connectionsApi]);

  useEffect(() => {
    machinesApi
      .listMachines()
      .then((list) => {
        setMachines(list);
        setMachinesLoaded(true);
      })
      .catch(() => {
        setMachines([]);
        setMachinesLoaded(false);
      });
  }, [machinesApi]);

  useEffect(() => {
    load();
  }, [load]);

  const retry = (): void => {
    setStatus('loading');
    load();
  };

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

  // Sets or clears the AI's home machine through the separate machine route,
  // exactly like web `AiPanel`. The outcome helper keeps the previous value
  // on failure and carries a fixed error sentence; the PUT answer is the
  // source of truth on success.
  const changeMachine = (machineId: string | null): void => {
    if (loaded === null || machineBusy) {
      return;
    }
    const previous = homeMachineId;
    const aiId = loaded.id;
    setMachineBusy(true);
    setMachineError('');
    void applyMachineChange(machinesApi, aiId, machineId, previous)
      .then((outcome) => {
        setHomeMachineId(outcome.home);
        setMachineError(outcome.error);
      })
      .finally(() => setMachineBusy(false));
  };

  const save = (): void => {
    if (loaded === null || savingRef.current) {
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
    savingRef.current = true;
    setSaving(true);
    setError('');
    void api
      .updateAi(loaded.id, patch)
      .then(() => router.back())
      .catch((cause: unknown) => {
        savingRef.current = false;
        setError(describeAisError(cause, 'Could not update the AI').message);
        setSaving(false);
      });
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
          <View className="items-center gap-3 pt-16">
            <ActivityIndicator color={ACCENT[scheme]} />
            <Text className="text-[15px] text-muted-foreground">Loading…</Text>
          </View>
        ) : status === 'error' ? (
          <View className="items-center gap-3 px-2 pt-12">
            <Text accessibilityRole="alert" className="text-center text-[15px] text-danger">
              {loadError}
            </Text>
            <Button variant="outline" onPress={retry}>
              <Text>Retry</Text>
            </Button>
          </View>
        ) : (
          <View className="gap-4">
            <View className="gap-1">
              <Text className="text-[14px] font-medium text-foreground">Name</Text>
              <TextInput
                value={name}
                onChangeText={setName}
                accessibilityLabel="Name"
                maxLength={64}
                className="rounded-lg border border-input bg-background px-3 py-2.5 text-[15px] text-foreground"
              />
            </View>

            <View className="gap-1">
              <Text className="text-[14px] font-medium text-foreground">Persona</Text>
              <TextInput
                value={persona}
                onChangeText={setPersona}
                accessibilityLabel="Persona"
                multiline
                maxLength={4000}
                className="min-h-[150px] rounded-lg border border-input bg-background px-3 py-2.5 text-[15px] text-foreground"
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
