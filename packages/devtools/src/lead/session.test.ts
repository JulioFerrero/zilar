import { describe, expect, it } from 'vitest';
import { summarizeSession } from './session.js';

function message(created: number, body: Record<string, unknown>): unknown {
  return { ...body, time: { created } };
}

describe('summarizeSession quota detection (T-1242)', () => {
  it('flags a provider.quota error', () => {
    const summary = summarizeSession([
      message(1, { type: 'assistant', text: 'ok' }),
      message(2, { type: 'error', error: { type: 'provider.quota', code: 'insufficient_quota' } }),
    ]);
    expect(summary.quotaError).toBe(true);
  });

  it("flags OpenCode Go's usage-limit error", () => {
    const summary = summarizeSession([
      message(2, {
        type: 'error',
        error: {
          type: 'provider.quota',
          code: 'gousagelimiterror',
          message: 'Go usage limit reached. Resets at 2026-10-12T04:00:00Z',
        },
      }),
    ]);
    expect(summary.quotaError).toBe(true);
  });

  it('flags a provider rate limit and a bare 429 error', () => {
    expect(
      summarizeSession([message(1, { type: 'error', error: { type: 'provider.rate-limit' } })])
        .quotaError,
    ).toBe(true);
    expect(
      summarizeSession([message(1, { type: 'error', status: 429, message: 'Too many requests' })])
        .quotaError,
    ).toBe(true);
  });

  it('does not flag ordinary tool text that only mentions a limit', () => {
    const summary = summarizeSession([
      message(1, {
        type: 'tool',
        name: 'bash',
        state: { status: 'completed', output: 'max connections limit reached' },
      }),
    ]);
    expect(summary.quotaError).toBe(false);
  });

  it('clears an old quota error once a later reply proves recovery', () => {
    const summary = summarizeSession([
      message(2, { type: 'assistant', text: 'all good' }),
      message(1, { type: 'error', error: { type: 'provider.quota' } }),
    ]);
    expect(summary.quotaError).toBe(false);
  });
});

describe('summarizeSession provider auth detection (T-1264)', () => {
  it('flags a provider.auth 401 error like a quota failure', () => {
    const summary = summarizeSession([
      message(2, {
        type: 'error',
        error: {
          type: 'provider.auth',
          message: 'Upstream request failed: Invalid credential',
          status: 401,
        },
      }),
    ]);
    expect(summary.quotaError).toBe(true);
  });

  it('clears an old provider.auth error once a later reply proves recovery', () => {
    const summary = summarizeSession([
      message(2, { type: 'assistant', text: 'all good' }),
      message(1, {
        type: 'error',
        error: { type: 'provider.auth', status: 401, message: 'Invalid credential' },
      }),
    ]);
    expect(summary.quotaError).toBe(false);
  });
});
