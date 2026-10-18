export type AiTemplateId = 'dev' | 'marketing' | 'fun' | 'custom';

// A `null` bound means the owner set no limit; new AIs start with both empty, so the server stores NULL.
export interface AiLimitsUsd {
  perDayUsd: number | null;
  perMonthUsd: number | null;
}

export interface AiCreateFields {
  name: string;
  template: AiTemplateId;
  persona: string;
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
// `persona` is omitted for an unedited stock template so the server applies its own default.
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

// PATCH carries only the fields that actually changed.
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
