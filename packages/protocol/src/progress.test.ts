import { describe, expect, it } from 'vitest';
import { CostSchema, decodeOrThrow, isValid, PreviewSchema, ProgressSchema } from './index';

describe('ProgressSchema', () => {
  const progress = {
    ai: 'dev-1@ai.example.com',
    task_id: 't-17',
    stage: 'running the test suite',
    detail: 'pnpm test',
    percent: 40,
  };

  it('accepts a full progress update', () => {
    expect(isValid(ProgressSchema)(progress)).toBe(true);
    expect(decodeOrThrow(ProgressSchema)(progress)).toEqual(progress);
  });

  it('accepts a progress update without optional fields', () => {
    expect(isValid(ProgressSchema)({ ai: progress.ai, stage: progress.stage })).toBe(true);
  });

  it('rejects a percent above 100', () => {
    expect(isValid(ProgressSchema)({ ...progress, percent: 101 })).toBe(false);
  });

  it('rejects a negative percent', () => {
    expect(isValid(ProgressSchema)({ ...progress, percent: -1 })).toBe(false);
  });

  it('rejects a fractional percent', () => {
    expect(isValid(ProgressSchema)({ ...progress, percent: 5.5 })).toBe(false);
  });

  it('rejects an empty stage', () => {
    expect(isValid(ProgressSchema)({ ...progress, stage: '' })).toBe(false);
  });

  it('rejects an extra key', () => {
    expect(isValid(ProgressSchema)({ ...progress, extra: true })).toBe(false);
  });
});

describe('PreviewSchema', () => {
  it('accepts an https preview', () => {
    const preview = {
      ai: 'qa@ai.example.com',
      url: 'https://p-7f3a.preview.example.com',
      label: 'Checkout fix on iOS',
      expires_at: '2026-09-28T00:00:00Z',
    };
    expect(isValid(PreviewSchema)(preview)).toBe(true);
    expect(decodeOrThrow(PreviewSchema)(preview)).toEqual(preview);
  });

  it('accepts an http preview without optional fields', () => {
    expect(isValid(PreviewSchema)({ ai: 'qa@ai.example.com', url: 'http://localhost:3000' })).toBe(
      true,
    );
  });

  it('rejects a non-http url', () => {
    expect(
      isValid(PreviewSchema)({ ai: 'qa@ai.example.com', url: 'ftp://files.example.com' }),
    ).toBe(false);
  });

  it('rejects a label longer than 100 characters', () => {
    expect(
      isValid(PreviewSchema)({
        ai: 'qa@ai.example.com',
        url: 'https://p-7f3a.preview.example.com',
        label: 'a'.repeat(101),
      }),
    ).toBe(false);
  });

  it('rejects a missing url', () => {
    expect(isValid(PreviewSchema)({ ai: 'qa@ai.example.com' })).toBe(false);
  });

  it('rejects an extra key', () => {
    expect(
      isValid(PreviewSchema)({
        ai: 'qa@ai.example.com',
        url: 'https://p-7f3a.preview.example.com',
        extra: true,
      }),
    ).toBe(false);
  });
});

describe('CostSchema', () => {
  it('accepts a full cost report', () => {
    const cost = {
      ai: 'dev-1@ai.example.com',
      room: 'project-a@rooms.example.com',
      amount: { currency: 'USD', amount: 0.12 },
      tokens: { input: 1000, output: 200 },
    };
    expect(isValid(CostSchema)(cost)).toBe(true);
    expect(decodeOrThrow(CostSchema)(cost)).toEqual(cost);
  });

  it('accepts a cost report without optional fields', () => {
    expect(
      isValid(CostSchema)({ ai: 'dev-1@ai.example.com', amount: { currency: 'EUR', amount: 0 } }),
    ).toBe(true);
  });

  it('rejects a negative amount', () => {
    expect(
      isValid(CostSchema)({
        ai: 'dev-1@ai.example.com',
        amount: { currency: 'EUR', amount: -1 },
      }),
    ).toBe(false);
  });

  it('rejects negative token counts', () => {
    expect(
      isValid(CostSchema)({
        ai: 'dev-1@ai.example.com',
        amount: { currency: 'EUR', amount: 1 },
        tokens: { input: -1, output: 0 },
      }),
    ).toBe(false);
  });

  it('rejects fractional token counts', () => {
    expect(
      isValid(CostSchema)({
        ai: 'dev-1@ai.example.com',
        amount: { currency: 'EUR', amount: 1 },
        tokens: { input: 1.5, output: 0 },
      }),
    ).toBe(false);
  });

  it('rejects an extra key', () => {
    expect(
      isValid(CostSchema)({
        ai: 'dev-1@ai.example.com',
        amount: { currency: 'EUR', amount: 1 },
        extra: true,
      }),
    ).toBe(false);
  });
});
