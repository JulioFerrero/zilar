import { describe, expect, it } from 'vitest';
import {
  buildCreateBody,
  buildPatch,
  DEFAULT_DAILY_USD,
  DEFAULT_MONTHLY_USD,
  type AiFormState,
} from './aiForm';

const limits = { perDayUsd: 2, perMonthUsd: 20 };

function form(overrides: Partial<AiFormState> = {}): AiFormState {
  return {
    name: 'Dev-1',
    template: 'dev',
    persona: 'server default text',
    personaTouched: false,
    providerConnectionId: 'c-1',
    model: 'gpt-4o',
    day: '2',
    month: '20',
    ...overrides,
  };
}

describe('aiForm defaults', () => {
  it('uses $1 per day and $10 per month', () => {
    expect(DEFAULT_DAILY_USD).toBe(1);
    expect(DEFAULT_MONTHLY_USD).toBe(10);
  });
});

describe('buildCreateBody', () => {
  it('omits persona for an untouched stock template and sends exactly the contract keys', () => {
    const body = buildCreateBody(form(), limits);
    expect(Object.keys(body ?? {})).toEqual([
      'name',
      'template',
      'providerConnectionId',
      'model',
      'limits',
    ]);
    expect(body).not.toHaveProperty('persona');
  });

  it('sends persona for a custom template and for an edited one', () => {
    expect(
      buildCreateBody(
        form({ template: 'custom', persona: 'Be a pirate.', personaTouched: true }),
        limits,
      ),
    ).toMatchObject({ template: 'custom', persona: 'Be a pirate.' });
    expect(
      buildCreateBody(
        form({ template: 'dev', persona: 'Custom text.', personaTouched: true }),
        limits,
      ),
    ).toMatchObject({ template: 'dev', persona: 'Custom text.' });
  });

  it('returns null without a connection or valid limits', () => {
    expect(buildCreateBody(form({ providerConnectionId: null }), limits)).toBeNull();
    expect(buildCreateBody(form(), null)).toBeNull();
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
