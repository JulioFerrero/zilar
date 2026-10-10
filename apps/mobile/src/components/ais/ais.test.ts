import { describe, expect, it } from 'vitest';

import { AisApiError } from '../../lib/ais-api';
import { describeAisError } from './errors';
import { providerLabel } from './providers';
import { WIZARD_STEP_LABELS, wizardSegmentState } from './wizard-progress';

describe('providerLabel', () => {
  it('maps known providers and falls back to the id', () => {
    expect(providerLabel('openai')).toBe('OpenAI');
    expect(providerLabel('acme')).toBe('acme');
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

describe('describeAisError not_active', () => {
  it('words the kill-switch race, which only the phone handles', () => {
    expect(describeAisError(new AisApiError(409, 'not_active', 'x'), 'f')).toEqual({
      message: 'This AI changed state. Refreshing the list…',
      unavailable: false,
    });
  });
});
