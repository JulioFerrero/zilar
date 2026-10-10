export type AiTemplateId = 'dev' | 'marketing' | 'fun' | 'custom';

export interface AiLimitsUsd {
  perDayUsd: number;
  perMonthUsd: number;
}

// Safe defaults for the quick-create dialog. They are named so the UI and the
// tests share one source; the server caps the month at MAX_MONTHLY_USD.
export const DEFAULT_DAILY_USD = 1;
export const DEFAULT_MONTHLY_USD = 10;

/** The form fields both apps send in a create request. */
export interface AiCreateFields {
  name: string;
  template: AiTemplateId;
  persona: string;
  /** Whether the persona differs from the template default. */
  personaTouched: boolean;
  providerConnectionId: string | null;
  model: string;
}

export interface AiCreateBody {
  name: string;
  template: AiTemplateId;
  persona?: string;
  providerConnectionId: string;
  model: string;
  limits: AiLimitsUsd;
}

export interface AiPatchBody {
  name?: string;
  persona?: string;
  limits?: AiLimitsUsd;
}

// The POST body the server's strict CreateAiSchema accepts: exactly these keys.
// `persona` is omitted for a stock template the user did not edit, so the
// server applies its own default.
export function buildCreateBody(
  form: AiCreateFields,
  limits: AiLimitsUsd | null,
): AiCreateBody | null {
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
  limits: AiLimitsUsd | null;
  originalLimits: AiLimitsUsd;
}): AiPatchBody | null {
  const patch: AiPatchBody = {};
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
