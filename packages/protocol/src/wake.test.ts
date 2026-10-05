import { describe, expect, it } from 'vitest';
import { WakeReasonSchema } from './index';

describe('WakeReasonSchema', () => {
  const wake = {
    ai: 'qa@ai.example.com',
    score: 0.8,
    reason: 'Dev asked QA to test the preview',
    message_ids: ['m-31', 'm-42'],
  };

  it('accepts a wake reason', () => {
    const result = WakeReasonSchema.safeParse(wake);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual(wake);
    }
  });

  it('accepts a wake reason with no message ids', () => {
    expect(WakeReasonSchema.safeParse({ ...wake, message_ids: [] }).success).toBe(true);
  });

  it('rejects a score above 1', () => {
    expect(WakeReasonSchema.safeParse({ ...wake, score: 1.1 }).success).toBe(false);
  });

  it('rejects a negative score', () => {
    expect(WakeReasonSchema.safeParse({ ...wake, score: -0.1 }).success).toBe(false);
  });

  it('rejects a reason longer than 300 characters', () => {
    expect(WakeReasonSchema.safeParse({ ...wake, reason: 'a'.repeat(301) }).success).toBe(false);
  });

  it('rejects more than 50 message ids', () => {
    const messageIds = Array.from({ length: 51 }, (_, index) => `m-${index}`);
    expect(WakeReasonSchema.safeParse({ ...wake, message_ids: messageIds }).success).toBe(false);
  });

  it('rejects an extra key', () => {
    expect(WakeReasonSchema.safeParse({ ...wake, extra: true }).success).toBe(false);
  });
});
