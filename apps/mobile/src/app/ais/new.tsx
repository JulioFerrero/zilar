import { useRouter } from 'expo-router';
import { Plus, Zap } from 'lucide-react-native';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Platform, TextInput, View } from 'react-native';
import { useColorScheme } from 'nativewind';

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
import { Text } from '@/components/ui/text';
import type { AiLimits, AiTemplate, Connection } from '@/lib/ais-api';
import { ACCENT, MUTED_FOREGROUND } from '@/lib/colors';
import { asColorScheme } from '@/lib/color-scheme';

const LAST_STEP = 6;

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
  const [connections, setConnections] = useState<Connection[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<AisErrorInfo>({ message: '', unavailable: false });
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState('');

  const loadConnections = useCallback(() => {
    void api
      .listConnections()
      .then((list) => {
        setConnections(list.filter((connection) => connection.status === 'active'));
        setLoadError({ message: '', unavailable: false });
      })
      .catch((error: unknown) => {
        setLoadError(describeAisError(error, 'Could not load your connections'));
      })
      .finally(() => setLoading(false));
  }, [api]);

  useEffect(() => {
    loadConnections();
  }, [loadConnections]);

  const retryConnections = (): void => {
    setLoading(true);
    loadConnections();
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

  const submit = (): void => {
    if (submitting) {
      return;
    }
    const input = buildCreateInput(form, limits.limits);
    if (input === null) {
      setStep(5);
      return;
    }
    setSubmitting(true);
    setSubmitError('');
    void api
      .createAi(input)
      .then((created) => {
        router.replace({ pathname: '/ais', params: { highlight: created.id } });
      })
      .catch((error: unknown) => {
        setSubmitError(describeAisError(error, 'Could not create the AI').message);
        setSubmitting(false);
      });
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
        <View className="items-center gap-3 pt-16">
          <ActivityIndicator color={ACCENT[scheme]} />
          <Text className="text-[15px] text-muted-foreground">Loading…</Text>
        </View>
      </AisScreenShell>
    );
  }

  if (loadError.message !== '' && connections.length === 0) {
    return (
      <AisScreenShell title="Create an AI" onBack={() => router.back()}>
        <View className="items-center gap-3 px-4 pt-12">
          <Text accessibilityRole="alert" className="text-center text-[15px] text-danger">
            {loadError.message}
          </Text>
          <Button variant="outline" onPress={retryConnections}>
            <Text>Retry</Text>
          </Button>
        </View>
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
                <TextInput
                  value={form.name}
                  onChangeText={(name) => setForm((previous) => ({ ...previous, name }))}
                  accessibilityLabel="Name"
                  placeholder="Dev-1"
                  placeholderTextColor={MUTED_FOREGROUND[scheme]}
                  maxLength={64}
                  className="rounded-lg border border-input bg-background px-3 py-2.5 text-[15px] text-foreground"
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
              <TextInput
                value={form.persona}
                onChangeText={(persona) =>
                  setForm((previous) => ({ ...previous, persona, personaTouched: true }))
                }
                accessibilityLabel="Persona"
                multiline
                maxLength={4000}
                placeholder="Describe how this AI should behave…"
                placeholderTextColor={MUTED_FOREGROUND[scheme]}
                className="min-h-[150px] rounded-lg border border-input bg-background px-3 py-2.5 text-[15px] text-foreground"
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
