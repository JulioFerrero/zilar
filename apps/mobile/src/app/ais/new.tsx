import { useRouter } from 'expo-router';
import { Plus, Zap } from 'lucide-react-native';
import { useRef, useState } from 'react';
import { KeyboardAvoidingView, Platform, View } from 'react-native';
import { useColorScheme } from 'nativewind';
import { Effect } from 'effect';
import { AsyncResult } from 'effect/reactivity';

import { RequireAisAuth } from '@/components/ais/require-ais-auth';
import { describeAisError, type AisErrorInfo } from '@/components/ais/errors';
import { buildCreateInput, type WizardForm } from '@/components/ais/form';
import { LimitsFields } from '@/components/ais/limits-fields';
import { formatLimit, validateLimits } from '@/components/ais/limits';
import { ModelPicker } from '@/components/ais/model-picker';
import { ProviderPicker } from '@/components/ais/provider-picker';
import { providerLabel } from '@/components/ais/providers';
import { AisScreenShell } from '@/components/ais/screen-shell';
import { TemplateCards } from '@/components/ais/template-cards';
import { defaultPersonaFor, templateLabel } from '@/components/ais/templates';
import { useAisApi } from '@/components/ais/use-ais-api';
import { WizardSteps } from '@/components/ais/wizard-steps';
import { Button } from '@/components/ui/button';
import { StateMessage } from '@/components/ui/state-message';
import { Text } from '@/components/ui/text';
import { TextField } from '@/components/ui/text-field';
import type { AiLimits, AiTemplate, Connection, CreateAiInput } from '@/lib/ais-api';
import { ACCENT } from '@/lib/colors';
import { asColorScheme } from '@/lib/color-scheme';
import { failureOf, isWaiting, useAction } from '@/lib/effect/use-action';
import { useQuery } from '@/lib/effect/use-query';

const LAST_STEP = 6;

// The raw rejection is kept, not mapped, so describeAisError still sees the
// AisApiError class and its fixed messages.
function rawCall<A>(call: () => Promise<A>) {
  return Effect.tryPromise({ try: call, catch: (cause) => ({ cause }) });
}

const INITIAL_FORM: WizardForm = {
  name: '',
  template: 'dev',
  persona: defaultPersonaFor('dev'),
  personaTouched: false,
  providerConnectionId: null,
  model: '',
};

export default function CreateAiScreen() {
  return (
    <RequireAisAuth>
      <CreateAiWizard />
    </RequireAisAuth>
  );
}

function CreateAiWizard() {
  const router = useRouter();
  const scheme = asColorScheme(useColorScheme().colorScheme);
  const { api } = useAisApi();

  const [form, setForm] = useState<WizardForm>(INITIAL_FORM);
  const [day, setDay] = useState('2');
  const [month, setMonth] = useState('20');
  const [step, setStep] = useState(1);
  // Guards against a double tap landing before React re-renders the disabled
  // button, so one Create can never POST twice.
  const submittingRef = useRef(false);

  // The active connections load on mount and again on Retry. A failure keeps
  // its raw cause for describeAisError; a waiting call hides the last one.
  const [listed, reloadConnections] = useQuery(
    () =>
      rawCall(() => api.listConnections()).pipe(
        Effect.map((list) => list.filter((connection) => connection.status === 'active')),
      ),
    [api],
  );
  const connections: Connection[] = AsyncResult.isSuccess(listed) ? listed.value : [];
  const loading = isWaiting(listed) || AsyncResult.isInitial(listed);
  const loadFailure = isWaiting(listed) ? undefined : failureOf(listed);
  const loadError: AisErrorInfo =
    loadFailure === undefined
      ? { message: '', unavailable: false }
      : describeAisError(loadFailure.cause, 'Could not load your connections');

  const retryConnections = (): void => {
    reloadConnections();
  };

  const limits = validateLimits(day, month);
  const selectedConnection =
    connections.find((connection) => connection.id === form.providerConnectionId) ?? null;

  const setTemplate = (template: AiTemplate): void => {
    setForm((previous) => ({
      ...previous,
      template,
      persona: template === 'custom' ? '' : defaultPersonaFor(template),
      personaTouched: false,
    }));
  };

  const canAdvance = ((): boolean => {
    switch (step) {
      case 1:
        return form.name.trim() !== '';
      case 2:
        return form.persona.trim() !== '';
      case 3:
        return form.providerConnectionId !== null;
      case 4:
        return form.model.trim() !== '';
      case 5:
        return limits.limits !== null;
      default:
        return true;
    }
  })();

  const goBack = (): void => {
    if (step > 1) {
      setStep(step - 1);
    } else {
      router.back();
    }
  };

  const [created, createAi] = useAction((input: CreateAiInput) =>
    rawCall(() => api.createAi(input)).pipe(
      Effect.tap((ai) =>
        Effect.sync(() => {
          router.replace({ pathname: '/ais', params: { highlight: ai.id } });
        }),
      ),
      Effect.tapError(() =>
        Effect.sync(() => {
          submittingRef.current = false;
        }),
      ),
    ),
  );
  // The button stays on "Creating…" after a success, until the route leaves.
  const submitting = isWaiting(created) || AsyncResult.isSuccess(created);
  const createFailure = isWaiting(created) ? undefined : failureOf(created);
  const submitError =
    createFailure === undefined
      ? ''
      : describeAisError(createFailure.cause, 'Could not create the AI').message;

  const submit = (): void => {
    if (submittingRef.current) {
      return;
    }
    const input = buildCreateInput(form, limits.limits);
    if (input === null) {
      setStep(5);
      return;
    }
    submittingRef.current = true;
    createAi(input);
  };

  if (loadError.unavailable) {
    return (
      <AisScreenShell title="Create an AI" onBack={() => router.back()}>
        <View className="items-center gap-3 px-4 pt-12">
          <Zap size={32} color={ACCENT[scheme]} />
          <Text accessibilityRole="alert" className="text-center text-[15px] text-danger">
            {loadError.message}
          </Text>
          <Text className="text-center text-[14px] text-muted-foreground">
            AI management is not available on this server.
          </Text>
        </View>
      </AisScreenShell>
    );
  }

  if (loading) {
    return (
      <AisScreenShell title="Create an AI" onBack={() => router.back()}>
        <StateMessage kind="loading" title="Loading…" />
      </AisScreenShell>
    );
  }

  if (loadError.message !== '' && connections.length === 0) {
    return (
      <AisScreenShell title="Create an AI" onBack={() => router.back()}>
        <StateMessage
          kind="error"
          title={loadError.message}
          action={{ label: 'Retry', onPress: retryConnections }}
        />
      </AisScreenShell>
    );
  }

  return (
    <KeyboardAvoidingView
      className="flex-1"
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <AisScreenShell
        title="Create an AI"
        subtitle={`Step ${step} of ${LAST_STEP}`}
        onBack={goBack}
        scroll
        footer={
          <>
            {step > 1 ? (
              <Button variant="ghost" disabled={submitting} onPress={() => setStep(step - 1)}>
                <Text>Back</Text>
              </Button>
            ) : null}
            {step < LAST_STEP ? (
              <Button className="flex-1" disabled={!canAdvance} onPress={() => setStep(step + 1)}>
                <Text>Next</Text>
              </Button>
            ) : (
              <Button className="flex-1" disabled={submitting} onPress={submit}>
                <Text>{submitting ? 'Creating…' : 'Create AI'}</Text>
              </Button>
            )}
          </>
        }
      >
        <View className="gap-5">
          <WizardSteps current={step} />

          {step === 1 && (
            <View className="gap-4">
              <View className="gap-1">
                <Text className="text-[14px] font-medium text-foreground">Name</Text>
                <TextField
                  value={form.name}
                  onChangeText={(name) => setForm((previous) => ({ ...previous, name }))}
                  accessibilityLabel="Name"
                  placeholder="Dev-1"
                  maxLength={64}
                />
              </View>
              <View className="gap-2">
                <Text className="text-[14px] font-medium text-foreground">Template</Text>
                <TemplateCards value={form.template} onChange={setTemplate} />
              </View>
            </View>
          )}

          {step === 2 && (
            <View className="gap-2">
              <Text className="text-[14px] font-medium text-foreground">Persona</Text>
              <TextField
                value={form.persona}
                onChangeText={(persona) =>
                  setForm((previous) => ({ ...previous, persona, personaTouched: true }))
                }
                accessibilityLabel="Persona"
                multiline
                maxLength={4000}
                placeholder="Describe how this AI should behave…"
                className="min-h-[150px]"
              />
              {form.template === 'custom' ? (
                <Text className="text-[13px] text-muted-foreground">
                  A custom AI needs a persona before you can continue.
                </Text>
              ) : null}
              <Text className="text-[13px] text-muted-foreground">
                The template fills this in. Editing it sends your version to the server.
              </Text>
            </View>
          )}

          {step === 3 &&
            (connections.length === 0 ? (
              <View className="items-center gap-3 rounded-xl border border-divider p-6">
                <Text className="text-center text-[15px] text-muted-foreground">
                  Add a provider key in the web app: menu → Connections
                </Text>
              </View>
            ) : (
              <ProviderPicker
                connections={connections}
                value={form.providerConnectionId}
                onChange={(providerConnectionId) =>
                  setForm((previous) => ({ ...previous, providerConnectionId }))
                }
              />
            ))}

          {step === 4 && (
            <ModelPicker
              provider={selectedConnection?.provider ?? ''}
              value={form.model}
              onChange={(model) => setForm((previous) => ({ ...previous, model }))}
            />
          )}

          {step === 5 && (
            <LimitsFields
              day={day}
              month={month}
              dayError={limits.dayError}
              monthError={limits.monthError}
              onDayChange={setDay}
              onMonthChange={setMonth}
            />
          )}

          {step === 6 && (
            <ReviewStep form={form} limits={limits.limits} connection={selectedConnection} />
          )}

          {submitError !== '' ? (
            <Text accessibilityRole="alert" className="text-[14px] text-danger">
              {submitError}
            </Text>
          ) : null}
        </View>
      </AisScreenShell>
    </KeyboardAvoidingView>
  );
}

function ReviewStep({
  form,
  limits,
  connection,
}: {
  form: WizardForm;
  limits: AiLimits | null;
  connection: Connection | null;
}) {
  const scheme = asColorScheme(useColorScheme().colorScheme);
  const rows: Array<[string, string]> = [
    ['Name', form.name.trim()],
    ['Template', templateLabel(form.template)],
    ['Provider', connection === null ? '—' : providerLabel(connection.provider)],
    ['Model', form.model.trim()],
    [
      'Limits',
      limits === null
        ? '—'
        : `${formatLimit(limits.perDayUsd)}/day · ${formatLimit(limits.perMonthUsd)}/month`,
    ],
  ];
  return (
    <View className="gap-3">
      <View className="overflow-hidden rounded-xl border border-divider">
        {rows.map(([label, value], index) => (
          <View
            key={label}
            className={
              index === 0
                ? 'flex-row items-start gap-3 px-3 py-2.5'
                : 'flex-row items-start gap-3 border-t border-divider px-3 py-2.5'
            }
          >
            <Text className="w-20 shrink-0 text-[13px] text-muted-foreground">{label}</Text>
            <Text className="min-w-0 flex-1 text-[15px] text-foreground">{value}</Text>
          </View>
        ))}
      </View>
      <View>
        <Text className="text-[13px] font-medium text-muted-foreground">Persona</Text>
        <Text className="mt-1 rounded-lg bg-muted px-3 py-2 text-[14px] text-foreground">
          {form.persona.trim() === '' ? '—' : form.persona}
        </Text>
      </View>
      <View className="flex-row items-center gap-1.5">
        <Plus size={14} color={ACCENT[scheme]} />
        <Text className="flex-1 text-[13px] text-muted-foreground">
          Creating this AI provisions its chat account and issues a capped provider key.
        </Text>
      </View>
    </View>
  );
}
