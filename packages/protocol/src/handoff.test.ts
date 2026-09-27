import { describe, expect, it } from 'vitest';
import { HandoffSchema } from './index';

const example = {
  task_id: 't-17',
  from: 'boss@ai.example.com',
  to: 'dev-1@ai.example.com',
  objective: 'Fix the checkout button overlapping the footer on mobile',
  context_summary:
    'Reported by Ana (PM) in #project-a at 10:12, screenshot attached. Affects iOS Safari only.',
  acceptance: ['Button fully visible at 375x667', 'No desktop layout change', 'Tests pass'],
  constraints: ['Only touch src/checkout/*', 'No new dependencies'],
  artifacts: [
    { kind: 'message', ref: 'm-31' },
    { kind: 'screenshot', ref: 'a-9' },
  ],
  budget: { currency: 'EUR', max: 3.0 },
  return_format: 'PR link + 3-line summary',
  reply_to: 'thread:m-31',
};

describe('HandoffSchema', () => {
  it('parses the plan example verbatim', () => {
    const result = HandoffSchema.safeParse(example);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual(example);
    }
  });

  it('rejects a handoff without objective', () => {
    const withoutObjective = {
      task_id: 't-17',
      from: 'boss@ai.example.com',
      to: 'dev-1@ai.example.com',
      context_summary:
        'Reported by Ana (PM) in #project-a at 10:12, screenshot attached. Affects iOS Safari only.',
      acceptance: ['Button fully visible at 375x667', 'No desktop layout change', 'Tests pass'],
      constraints: ['Only touch src/checkout/*', 'No new dependencies'],
      artifacts: [
        { kind: 'message', ref: 'm-31' },
        { kind: 'screenshot', ref: 'a-9' },
      ],
      budget: { currency: 'EUR', max: 3.0 },
      return_format: 'PR link + 3-line summary',
      reply_to: 'thread:m-31',
    };
    expect(HandoffSchema.safeParse(withoutObjective).success).toBe(false);
  });

  it('rejects a negative budget max', () => {
    expect(
      HandoffSchema.safeParse({ ...example, budget: { currency: 'EUR', max: -1 } }).success,
    ).toBe(false);
  });

  it('rejects an unknown artifact kind', () => {
    expect(
      HandoffSchema.safeParse({ ...example, artifacts: [{ kind: 'video', ref: 'm-1' }] }).success,
    ).toBe(false);
  });

  it('rejects a from JID without @', () => {
    expect(HandoffSchema.safeParse({ ...example, from: 'boss.example.com' }).success).toBe(false);
  });

  it('rejects a context_summary longer than 2000 characters', () => {
    expect(HandoffSchema.safeParse({ ...example, context_summary: 'a'.repeat(2001) }).success).toBe(
      false,
    );
    expect(HandoffSchema.safeParse({ ...example, context_summary: 'a'.repeat(2000) }).success).toBe(
      true,
    );
  });
});
