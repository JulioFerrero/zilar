import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Platform, TextInput, View } from 'react-native';
import { useColorScheme } from 'nativewind';

import { RequireAisAuth } from '@/components/ais/require-ais-auth';
import { describeAisError } from '@/components/ais/errors';
import { buildPatch } from '@/components/ais/form';
import { LimitsFields } from '@/components/ais/limits-fields';
import { validateLimits } from '@/components/ais/limits';
import { AisScreenShell } from '@/components/ais/screen-shell';
import { useAisApi } from '@/components/ais/use-ais-api';
import { Button } from '@/components/ui/button';
import { Text } from '@/components/ui/text';
import { ACCENT } from '@/lib/colors';
import { asColorScheme } from '@/lib/color-scheme';
import type { PublicAi } from '@/lib/ais-api';

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
  const params = useLocalSearchParams<{ id: string }>();
  const id = typeof params.id === 'string' ? params.id : '';

  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [loaded, setLoaded] = useState<PublicAi | null>(null);
  const [loadError, setLoadError] = useState('');

  const [name, setName] = useState('');
  const [persona, setPersona] = useState('');
  const [day, setDay] = useState('2');
  const [month, setMonth] = useState('20');
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
        setStatus('ready');
      })
      .catch((cause: unknown) => {
        setLoadError(describeAisError(cause, 'Could not load the AI').message);
        setStatus('error');
      });
  }, [api, id]);

  useEffect(() => {
    load();
  }, [load]);

  const retry = (): void => {
    setStatus('loading');
    load();
  };

  const limits = validateLimits(day, month);
  const canSave = loaded !== null && name.trim() !== '' && limits.limits !== null && !saving;

  const save = (): void => {
    if (loaded === null || savingRef.current) {
      return;
    }
    const patch = buildPatch({
      name,
      originalName: loaded.name,
      persona,
      originalPersona: loaded.persona,
      limits: limits.limits,
      originalLimits: loaded.limits,
    });
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
