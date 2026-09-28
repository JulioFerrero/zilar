import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { Plus, Zap } from 'lucide-react';
import {
  createAi,
  listConnections,
  type AiTemplate,
  type Connection,
  type CreateAiInput,
} from '@/lib/api';
import { AiPageShell, Button, FieldError } from '@/components/ais/AiPageShell';
import { ConnectionPicker, providerLabel } from '@/components/ais/ConnectionPicker';
import { describeAiError } from '@/components/ais/errors';
import { LimitsFields } from '@/components/ais/LimitsFields';
import { formatLimit, validateLimits } from '@/components/ais/limits';
import { ModelPicker } from '@/components/ais/ModelPicker';
import { modelSuggestionsFor } from '@/components/ais/models';
import { TemplateCards } from '@/components/ais/TemplateCards';
import { defaultPersonaFor, templateLabel } from '@/components/ais/templates';
import { WizardSteps } from '@/components/ais/WizardSteps';

const LAST_STEP = 6;

interface FormState {
  name: string;
  template: AiTemplate;
  persona: string;
  /** Whether the persona differs from the template default. */
  personaTouched: boolean;
  providerConnectionId: string | null;
  model: string;
  day: string;
  month: string;
}

const INITIAL_FORM: FormState = {
  name: '',
  template: 'dev',
  persona: defaultPersonaFor('dev'),
  personaTouched: false,
  providerConnectionId: null,
  model: '',
  day: '2',
  month: '20',
};

/** The wizard's body, wrapped by CreateAiPage. */
export function CreateAiWizard() {
  const navigate = useNavigate();
  const [form, setForm] = useState<FormState>(INITIAL_FORM);
  const [step, setStep] = useState(1);
  const [connections, setConnections] = useState<Connection[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [unavailable, setUnavailable] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState('');

  const loadConnections = useCallback(async () => {
    try {
      const list = await listConnections();
      setConnections(list.filter((connection) => connection.status === 'active'));
      setUnavailable(false);
      setLoadError('');
    } catch (error) {
      const info = describeAiError(error, 'Could not load your connections');
      setUnavailable(info.unavailable);
      setLoadError(info.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let active = true;
    void listConnections()
      .then((list) => {
        if (active) {
          setConnections(list.filter((connection) => connection.status === 'active'));
        }
      })
      .catch((error: unknown) => {
        if (active) {
          const info = describeAiError(error, 'Could not load your connections');
          setUnavailable(info.unavailable);
          setLoadError(info.message);
        }
      })
      .finally(() => {
        if (active) {
          setLoading(false);
        }
      });
    return () => {
      active = false;
    };
  }, []);

  const retry = (): void => {
    setLoading(true);
    void loadConnections();
  };

  const limits = validateLimits(form.day, form.month);
  const selectedConnection =
    connections.find((connection) => connection.id === form.providerConnectionId) ?? null;

  if (unavailable) {
    return (
      <AiPageShell
        title="Create an AI"
        subtitle="Step 1 of 6"
        onBack={() => navigate('/settings/ais')}
      >
        <div className="flex flex-col items-center gap-3 text-center">
          <Zap className="size-8 text-muted-foreground" aria-hidden="true" />
          <p role="alert" className="text-[15px] text-danger">
            {loadError}
          </p>
          <p className="text-[14px] text-muted-foreground">
            AI management is not available on this server.
          </p>
        </div>
      </AiPageShell>
    );
  }

  if (loading) {
    return (
      <AiPageShell
        title="Create an AI"
        subtitle="Step 1 of 6"
        onBack={() => navigate('/settings/ais')}
      >
        <p className="text-[15px] text-muted-foreground">Loading…</p>
      </AiPageShell>
    );
  }

  if (loadError !== '' && connections.length === 0) {
    return (
      <AiPageShell
        title="Create an AI"
        subtitle="Step 1 of 6"
        onBack={() => navigate('/settings/ais')}
      >
        <div className="flex flex-col items-center gap-3 text-center">
          <p role="alert" className="text-[15px] text-danger">
            {loadError}
          </p>
          <Button type="button" size="lg" className="rounded-full px-5" onClick={retry}>
            Retry
          </Button>
        </div>
      </AiPageShell>
    );
  }

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

  const goNext = (): void => {
    if (canAdvance && step < LAST_STEP) {
      setStep(step + 1);
    }
  };
  const goBack = (): void => {
    if (step > 1) {
      setStep(step - 1);
    }
  };

  const submit = async (): Promise<void> => {
    const built = buildBody(form, limits);
    if (built === null) {
      setStep(5);
      return;
    }
    setSubmitting(true);
    setSubmitError('');
    try {
      const created = await createAi(built);
      navigate('/settings/ais', { state: { highlightId: created.id } });
    } catch (error) {
      setSubmitError(describeAiError(error, 'Could not create the AI').message);
      setSubmitting(false);
    }
  };

  return (
    <AiPageShell
      title="Create an AI"
      subtitle={`Step ${step} of ${LAST_STEP}`}
      onBack={() => navigate('/settings/ais')}
    >
      <SimplifiedWizard
        step={step}
        form={form}
        connections={connections}
        limits={limits}
        canAdvance={canAdvance}
        submitting={submitting}
        submitError={submitError}
        selectedProviderId={selectedConnection?.id ?? null}
        setForm={setForm}
        goBack={goBack}
        goNext={goNext}
        onSubmit={() => void submit()}
      />
    </AiPageShell>
  );
}

export function CreateAiPage() {
  return <CreateAiWizard />;
}

// The POST body the server's strict CreateAiSchema accepts: exactly these keys.
// `persona` is omitted for a stock template the user did not edit, so the
// server applies its own default.
export function buildBody(
  form: FormState,
  limits: ReturnType<typeof validateLimits>,
): CreateAiInput | null {
  if (form.providerConnectionId === null || limits.limits === null) {
    return null;
  }
  const sendPersona = form.template === 'custom' || form.personaTouched;
  return {
    name: form.name.trim(),
    template: form.template,
    ...(sendPersona ? { persona: form.persona.trim() } : {}),
    providerConnectionId: form.providerConnectionId,
    model: form.model.trim(),
    limits: limits.limits,
  };
}

interface SimplifiedWizardProps {
  step: number;
  form: FormState;
  connections: Connection[];
  limits: ReturnType<typeof validateLimits>;
  canAdvance: boolean;
  submitting: boolean;
  submitError: string;
  selectedProviderId: string | null;
  setForm: React.Dispatch<React.SetStateAction<FormState>>;
  goBack: () => void;
  goNext: () => void;
  onSubmit: () => void;
}

function SimplifiedWizard({
  step,
  form,
  connections,
  limits,
  canAdvance,
  submitting,
  submitError,
  selectedProviderId,
  setForm,
  goBack,
  goNext,
  onSubmit,
}: SimplifiedWizardProps) {
  const setTemplate = (template: AiTemplate): void => {
    setForm((previous) => ({
      ...previous,
      template,
      persona: template === 'custom' ? '' : defaultPersonaFor(template),
      personaTouched: false,
    }));
  };

  return (
    <div className="mx-auto flex w-full max-w-xl flex-col gap-5">
      <WizardSteps current={step} />

      {step === 1 && (
        <div className="flex flex-col gap-4">
          <label className="flex flex-col gap-1">
            <span className="text-[14px] font-medium">Name</span>
            <input
              value={form.name}
              onChange={(event) =>
                setForm((previous) => ({ ...previous, name: event.target.value }))
              }
              placeholder="Dev-1"
              maxLength={64}
              className="rounded-lg border border-input bg-background px-3 py-2 text-[15px] outline-none focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-accent/40"
            />
          </label>
          <div className="flex flex-col gap-2">
            <span className="text-[14px] font-medium">Template</span>
            <TemplateCards value={form.template} onChange={setTemplate} />
          </div>
        </div>
      )}

      {step === 2 && (
        <div className="flex flex-col gap-2">
          <label className="flex flex-col gap-1">
            <span className="text-[14px] font-medium">Persona</span>
            <textarea
              rows={7}
              maxLength={4000}
              value={form.persona}
              onChange={(event) =>
                setForm((previous) => ({
                  ...previous,
                  persona: event.target.value,
                  personaTouched: true,
                }))
              }
              placeholder="Describe how this AI should behave…"
              className="rounded-lg border border-input bg-background px-3 py-2 text-[15px] outline-none focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-accent/40"
            />
          </label>
          {form.template === 'custom' && (
            <p className="text-[13px] text-muted-foreground">
              A custom AI needs a persona before you can continue.
            </p>
          )}
          <p className="text-[13px] text-muted-foreground">
            The template fills this in. Editing it sends your version to the server.
          </p>
        </div>
      )}

      {step === 3 && (
        <div className="flex flex-col gap-3">
          {connections.length === 0 ? (
            <div className="flex flex-col items-center gap-3 rounded-xl border border-divider p-6 text-center">
              <p className="text-[15px] text-muted-foreground">
                You have no active provider connections yet.
              </p>
              <Link
                to="/settings/connections"
                className="rounded-full bg-accent px-5 py-2 text-[15px] font-medium text-accent-foreground hover:bg-accent/90"
              >
                Connections
              </Link>
            </div>
          ) : (
            <ConnectionPicker
              connections={connections}
              value={form.providerConnectionId}
              onChange={(id) => setForm((previous) => ({ ...previous, providerConnectionId: id }))}
            />
          )}
        </div>
      )}

      {step === 4 && (
        <ModelPickerStep
          providerId={selectedProviderId}
          model={form.model}
          onModelChange={(model) => setForm((previous) => ({ ...previous, model }))}
        />
      )}

      {step === 5 && (
        <LimitsFields
          day={form.day}
          month={form.month}
          dayError={limits.dayError}
          monthError={limits.monthError}
          onDayChange={(day) => setForm((previous) => ({ ...previous, day }))}
          onMonthChange={(month) => setForm((previous) => ({ ...previous, month }))}
        />
      )}

      {step === 6 && <ReviewStep form={form} limits={limits} connections={connections} />}

      {submitError !== '' && <FieldError>{submitError}</FieldError>}

      <div className="flex items-center gap-2">
        {step > 1 && (
          <Button
            type="button"
            variant="ghost"
            size="lg"
            className="rounded-full px-4"
            disabled={submitting}
            onClick={goBack}
          >
            Back
          </Button>
        )}
        {step < LAST_STEP ? (
          <Button
            type="button"
            size="lg"
            className="rounded-full px-5"
            disabled={!canAdvance}
            onClick={goNext}
          >
            Next
          </Button>
        ) : (
          <Button
            type="button"
            size="lg"
            className="rounded-full px-5"
            disabled={submitting}
            onClick={onSubmit}
          >
            {submitting ? 'Creating…' : 'Create AI'}
          </Button>
        )}
      </div>
    </div>
  );
}

function ModelPickerStep({
  providerId,
  model,
  onModelChange,
}: {
  providerId: string | null;
  model: string;
  onModelChange: (model: string) => void;
}) {
  return (
    <ModelPicker
      provider={providerId ?? ''}
      suggestions={providerId === null ? [] : modelSuggestionsFor(providerId)}
      value={model}
      onChange={onModelChange}
    />
  );
}

function ReviewStep({
  form,
  limits,
  connections,
}: {
  form: FormState;
  limits: ReturnType<typeof validateLimits>;
  connections: Connection[];
}) {
  const connection = connections.find((item) => item.id === form.providerConnectionId) ?? null;
  const rows: Array<[string, string]> = [
    ['Name', form.name.trim()],
    ['Template', templateLabel(form.template)],
    ['Provider', connection === null ? '—' : providerLabel(connection.provider)],
    ['Model', form.model.trim()],
    [
      'Limits',
      limits.limits === null
        ? '—'
        : `${formatLimit(limits.limits.perDayUsd)}/day · ${formatLimit(limits.limits.perMonthUsd)}/month`,
    ],
  ];
  return (
    <div className="flex flex-col gap-3">
      <dl className="divide-y divide-divider rounded-xl border border-divider">
        {rows.map(([label, value]) => (
          <div key={label} className="flex items-start gap-3 px-3 py-2.5">
            <dt className="w-24 shrink-0 text-[13px] text-muted-foreground">{label}</dt>
            <dd className="min-w-0 flex-1 break-words text-[15px]">{value}</dd>
          </div>
        ))}
      </dl>
      <div>
        <p className="text-[13px] font-medium text-muted-foreground">Persona</p>
        <p className="mt-1 rounded-lg bg-muted px-3 py-2 text-[14px] whitespace-pre-wrap">
          {form.persona.trim() === '' ? '—' : form.persona}
        </p>
      </div>
      <p className="flex items-center gap-1.5 text-[13px] text-muted-foreground">
        <Plus className="size-3.5" aria-hidden="true" />
        Creating this AI provisions its chat account and issues a capped provider key.
      </p>
    </div>
  );
}
