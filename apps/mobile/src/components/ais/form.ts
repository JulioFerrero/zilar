import type { AiLimits, AiTemplate, CreateAiInput, UpdateAiInput } from '../../lib/ais-api';

/** The wizard's mutable form, before it becomes a `CreateAiInput`. */
export interface WizardForm {
  name: string;
  template: AiTemplate;
  persona: string;
  /** Whether the persona differs from the template default. */
  personaTouched: boolean;
  providerConnectionId: string | null;
  model: string;
}

// The POST body the server's strict CreateAiSchema accepts: exactly the
// contract keys. `persona` is omitted for a stock template the user did not
// edit, so the server applies its own default.
export function buildCreateInput(form: WizardForm, limits: AiLimits | null): CreateAiInput | null {
  if (form.providerConnectionId === null || limits === null) {
    return null;
  }
  const sendPersona = form.template === 'custom' || form.personaTouched;
  return {
    name: form.name.trim(),
    template: form.template,
    ...(sendPersona ? { persona: form.persona.trim() } : {}),
    providerConnectionId: form.providerConnectionId,
    model: form.model.trim(),
    limits,
  };
}

/** PATCH carries only the fields that actually changed; null means nothing did. */
export function buildPatch(input: {
  name: string;
  originalName: string;
  persona: string;
  originalPersona: string;
  limits: AiLimits | null;
  originalLimits: AiLimits;
}): UpdateAiInput | null {
  const patch: UpdateAiInput = {};
  if (input.name.trim() !== input.originalName) {
    patch.name = input.name.trim();
  }
  if (input.persona.trim() !== input.originalPersona) {
    patch.persona = input.persona.trim();
  }
  if (
    input.limits !== null &&
    (input.limits.perDayUsd !== input.originalLimits.perDayUsd ||
      input.limits.perMonthUsd !== input.originalLimits.perMonthUsd)
  ) {
    patch.limits = input.limits;
  }
  return Object.keys(patch).length === 0 ? null : patch;
}
