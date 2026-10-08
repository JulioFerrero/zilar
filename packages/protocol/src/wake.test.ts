import { describe, expect, it } from 'vitest';
import { decodeOrThrow, isValid, WakeReasonSchema } from './index';

describe('WakeReasonSchema', () => {
  const wake = {
    ai: 'qa@ai.example.com',
    score: 0.8,
    reason: 'Dev asked QA to test the preview',
    message_ids: ['m-31', 'm-42'],
  };

  it('accepts a wake reason', () => {
    expect(isValid(WakeReasonSchema)(wake)).toBe(true);
    expect(decodeOrThrow(WakeReasonSchema)(wake)).toEqual(wake);
  });

  it('accepts a wake reason with no message ids', () => {
    expect(isValid(WakeReasonSchema)({ ...wake, message_ids: [] })).toBe(true);
  });

  it('rejects a score above 1', () => {
    expect(isValid(WakeReasonSchema)({ ...wake, score: 1.1 })).toBe(false);
  });

  it('rejects a negative score', () => {
    expect(isValid(WakeReasonSchema)({ ...wake, score: -0.1 })).toBe(false);
  });

  it('rejects a reason longer than 300 characters', () => {
    expect(isValid(WakeReasonSchema)({ ...wake, reason: 'a'.repeat(301) })).toBe(false);
  });

  it('rejects more than 50 message ids', () => {
    const messageIds = Array.from({ length: 51 }, (_, index) => `m-${index}`);
    expect(isValid(WakeReasonSchema)({ ...wake, message_ids: messageIds })).toBe(false);
  });

  it('rejects an extra key', () => {
    expect(isValid(WakeReasonSchema)({ ...wake, extra: true })).toBe(false);
  });
});
