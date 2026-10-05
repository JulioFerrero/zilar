import { describe, expect, it } from 'vitest';
import { CostSchema, PreviewSchema, ProgressSchema } from './index';

describe('ProgressSchema', () => {
  const progress = {
    ai: 'dev-1@ai.example.com',
    task_id: 't-17',
    stage: 'running the test suite',
    detail: 'pnpm test',
    percent: 40,
  };

  it('accepts a full progress update', () => {
    const result = ProgressSchema.safeParse(progress);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual(progress);
    }
  });

  it('accepts a progress update without optional fields', () => {
    expect(ProgressSchema.safeParse({ ai: progress.ai, stage: progress.stage }).success).toBe(true);
  });

  it('rejects a percent above 100', () => {
    expect(ProgressSchema.safeParse({ ...progress, percent: 101 }).success).toBe(false);
  });

  it('rejects a negative percent', () => {
    expect(ProgressSchema.safeParse({ ...progress, percent: -1 }).success).toBe(false);
  });

  it('rejects a fractional percent', () => {
    expect(ProgressSchema.safeParse({ ...progress, percent: 5.5 }).success).toBe(false);
  });

  it('rejects an empty stage', () => {
    expect(ProgressSchema.safeParse({ ...progress, stage: '' }).success).toBe(false);
  });

  it('rejects an extra key', () => {
    expect(ProgressSchema.safeParse({ ...progress, extra: true }).success).toBe(false);
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
    const result = PreviewSchema.safeParse(preview);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual(preview);
    }
  });

  it('accepts an http preview without optional fields', () => {
    expect(
      PreviewSchema.safeParse({ ai: 'qa@ai.example.com', url: 'http://localhost:3000' }).success,
    ).toBe(true);
  });

  it('rejects a non-http url', () => {
    expect(
      PreviewSchema.safeParse({ ai: 'qa@ai.example.com', url: 'ftp://files.example.com' }).success,
    ).toBe(false);
  });

  it('rejects a label longer than 100 characters', () => {
    expect(
      PreviewSchema.safeParse({
        ai: 'qa@ai.example.com',
        url: 'https://p-7f3a.preview.example.com',
        label: 'a'.repeat(101),
      }).success,
    ).toBe(false);
  });

  it('rejects a missing url', () => {
    expect(PreviewSchema.safeParse({ ai: 'qa@ai.example.com' }).success).toBe(false);
  });

  it('rejects an extra key', () => {
    expect(
      PreviewSchema.safeParse({
        ai: 'qa@ai.example.com',
        url: 'https://p-7f3a.preview.example.com',
        extra: true,
      }).success,
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
    const result = CostSchema.safeParse(cost);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual(cost);
    }
  });

  it('accepts a cost report without optional fields', () => {
    expect(
      CostSchema.safeParse({ ai: 'dev-1@ai.example.com', amount: { currency: 'EUR', amount: 0 } })
        .success,
    ).toBe(true);
  });

  it('rejects a negative amount', () => {
    expect(
      CostSchema.safeParse({
        ai: 'dev-1@ai.example.com',
        amount: { currency: 'EUR', amount: -1 },
      }).success,
    ).toBe(false);
  });

  it('rejects negative token counts', () => {
    expect(
      CostSchema.safeParse({
        ai: 'dev-1@ai.example.com',
        amount: { currency: 'EUR', amount: 1 },
        tokens: { input: -1, output: 0 },
      }).success,
    ).toBe(false);
  });

  it('rejects fractional token counts', () => {
    expect(
      CostSchema.safeParse({
        ai: 'dev-1@ai.example.com',
        amount: { currency: 'EUR', amount: 1 },
        tokens: { input: 1.5, output: 0 },
      }).success,
    ).toBe(false);
  });

  it('rejects an extra key', () => {
    expect(
      CostSchema.safeParse({
        ai: 'dev-1@ai.example.com',
        amount: { currency: 'EUR', amount: 1 },
        extra: true,
      }).success,
    ).toBe(false);
  });
});
