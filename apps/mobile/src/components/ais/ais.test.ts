import { describe, expect, it } from 'vitest';

import { AisApiError } from '../../lib/ais-api';
import { describeAisError } from './errors';
import { buildCreateInput, buildPatch, type WizardForm } from './form';
import { MAX_MONTHLY_USD, formatLimit, validateLimits } from './limits';
import { modelSuggestionsFor } from './models';
import { providerLabel } from './providers';
import { defaultPersonaFor, templateLabel } from './templates';
import { WIZARD_STEP_LABELS, wizardSegmentState } from './wizard-progress';

const baseForm: WizardForm = {
  name: 'Dev-1',
  template: 'dev',
  persona: defaultPersonaFor('dev'),
  personaTouched: false,
  providerConnectionId: 'c-1',
  model: 'gpt-4o',
};

const limits = { perDayUsd: 2, perMonthUsd: 20 };

describe('buildCreateInput', () => {
  it('omits persona for an untouched stock template', () => {
    const input = buildCreateInput(baseForm, limits);
    expect(Object.keys(input ?? {})).toEqual([
      'name',
      'template',
      'providerConnectionId',
      'model',
      'limits',
    ]);
    expect(input).not.toHaveProperty('persona');
  });

  it('sends persona for a custom template and for an edited one', () => {
    expect(
      buildCreateInput(
        { ...baseForm, template: 'custom', persona: 'Be a pirate.', personaTouched: true },
        limits,
      ),
    ).toMatchObject({ template: 'custom', persona: 'Be a pirate.' });
    expect(
      buildCreateInput({ ...baseForm, persona: 'Custom text.', personaTouched: true }, limits),
    ).toMatchObject({ template: 'dev', persona: 'Custom text.' });
  });

  it('returns null without a connection or valid limits', () => {
    expect(buildCreateInput({ ...baseForm, providerConnectionId: null }, limits)).toBeNull();
    expect(buildCreateInput(baseForm, null)).toBeNull();
  });
});

describe('buildPatch', () => {
  it('returns null when nothing changed', () => {
    expect(
      buildPatch({
        name: 'Dev-1',
        originalName: 'Dev-1',
        persona: 'p',
        originalPersona: 'p',
        limits,
        originalLimits: limits,
      }),
    ).toBeNull();
  });

  it('sends only the fields that changed', () => {
    expect(
      buildPatch({
        name: 'Dev-2',
        originalName: 'Dev-1',
        persona: 'p',
        originalPersona: 'p',
        limits,
        originalLimits: limits,
      }),
    ).toEqual({ name: 'Dev-2' });
    expect(
      buildPatch({
        name: 'Dev-1',
        originalName: 'Dev-1',
        persona: 'p',
        originalPersona: 'p',
        limits: { perDayUsd: 3, perMonthUsd: 20 },
        originalLimits: limits,
      }),
    ).toEqual({ limits: { perDayUsd: 3, perMonthUsd: 20 } });
  });
});

describe('validateLimits', () => {
  it('accepts the defaults', () => {
    expect(validateLimits('2', '20')).toEqual({
      limits: { perDayUsd: 2, perMonthUsd: 20 },
      dayError: '',
      monthError: '',
    });
  });

  it('rejects a day above the month', () => {
    const result = validateLimits('30', '20');
    expect(result.limits).toBeNull();
    expect(result.dayError).toBe('The daily limit must not exceed the monthly limit');
  });

  it('caps the month', () => {
    const result = validateLimits('2', String(MAX_MONTHLY_USD + 1));
    expect(result.limits).toBeNull();
    expect(result.monthError).toBe(`The monthly limit must be at most $${MAX_MONTHLY_USD}`);
  });

  it('rejects zero, negatives and non-numbers', () => {
    expect(validateLimits('0', '20').limits).toBeNull();
    expect(validateLimits('abc', '20').limits).toBeNull();
  });

  it('formats a limit as dollars', () => {
    expect(formatLimit(2)).toBe('$2');
  });
});

describe('modelSuggestionsFor', () => {
  it('keys the suggestions by provider, never by connection id', () => {
    expect(modelSuggestionsFor('openai')).toContain('gpt-4o-mini');
    expect(modelSuggestionsFor('c31a71e2-cada-40e3-8705-2fc42929bce7')).toEqual([]);
  });
});

describe('providerLabel', () => {
  it('maps known providers and falls back to the id', () => {
    expect(providerLabel('openai')).toBe('OpenAI');
    expect(providerLabel('acme')).toBe('acme');
  });
});

describe('templates', () => {
  it('labels templates and gives custom no default persona', () => {
    expect(templateLabel('marketing')).toBe('Marketing');
    expect(defaultPersonaFor('custom')).toBe('');
    expect(defaultPersonaFor('dev')).toContain('senior engineer');
  });
});

describe('describeAisError', () => {
  it('maps ais_unavailable to the unavailable state', () => {
    const info = describeAisError(new AisApiError(503, 'ais_unavailable', 'x'), 'fallback');
    expect(info).toEqual({
      message: "AI management isn't configured on this server.",
      unavailable: true,
    });
  });

  it('maps connection errors', () => {
    expect(describeAisError(new AisApiError(400, 'invalid_connection', 'x'), 'f').message).toBe(
      "That connection can't be used. Pick another one or re-add it.",
    );
  });

  it('maps provisioning failures', () => {
    expect(
      describeAisError(new AisApiError(502, 'ai_provisioning_failed', 'x'), 'f').message,
    ).toContain("The server couldn't finish");
  });

  it('keeps the server message for other codes', () => {
    expect(describeAisError(new AisApiError(400, 'invalid_request', 'name too long'), 'f')).toEqual(
      {
        message: 'name too long',
        unavailable: false,
      },
    );
  });
});

describe('wizardSegmentState', () => {
  it('marks earlier steps done, the current one active and later ones pending', () => {
    expect([1, 2, 3, 4, 5, 6].map((step) => wizardSegmentState(step, 4))).toEqual([
      'done',
      'done',
      'done',
      'active',
      'pending',
      'pending',
    ]);
  });

  it('fills steps 1..current on every step', () => {
    const steps = WIZARD_STEP_LABELS.map((_, index) => index + 1);
    for (const current of steps) {
      const states = steps.map((step) => wizardSegmentState(step, current));
      expect(states.filter((state) => state === 'done')).toHaveLength(current - 1);
      expect(states.filter((state) => state === 'active')).toHaveLength(1);
      expect(states.filter((state) => state === 'pending')).toHaveLength(steps.length - current);
    }
  });
});
