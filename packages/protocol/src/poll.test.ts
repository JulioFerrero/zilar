import { describe, expect, it } from 'vitest';
import { PollSchema, PollVoteSchema } from './index';

const poll = {
  id: 'p-1',
  question: 'Where should the offsite be?',
  options: [
    { id: 'o-1', label: 'Beach' },
    { id: 'o-2', label: 'Mountains' },
  ],
  multiple: false,
  closes_at: '2026-09-30T18:00:00Z',
};

describe('PollSchema', () => {
  it('accepts a poll', () => {
    const result = PollSchema.safeParse(poll);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual(poll);
    }
  });

  it('rejects duplicate option ids', () => {
    expect(
      PollSchema.safeParse({
        ...poll,
        options: [
          { id: 'o-1', label: 'Beach' },
          { id: 'o-1', label: 'Mountains' },
        ],
      }).success,
    ).toBe(false);
  });

  it('rejects a single option', () => {
    expect(
      PollSchema.safeParse({ ...poll, options: [{ id: 'o-1', label: 'Beach' }] }).success,
    ).toBe(false);
  });

  it('rejects more than 10 options', () => {
    const options = Array.from({ length: 11 }, (_, index) => ({
      id: `o-${index}`,
      label: `Option ${index}`,
    }));
    expect(PollSchema.safeParse({ ...poll, options }).success).toBe(false);
  });

  it('rejects an empty option label', () => {
    expect(
      PollSchema.safeParse({
        ...poll,
        options: [
          { id: 'o-1', label: '' },
          { id: 'o-2', label: 'Mountains' },
        ],
      }).success,
    ).toBe(false);
  });

  it('rejects an extra key on an option', () => {
    expect(
      PollSchema.safeParse({
        ...poll,
        options: [
          { id: 'o-1', label: 'Beach', extra: true },
          { id: 'o-2', label: 'Mountains' },
        ],
      }).success,
    ).toBe(false);
  });
});

const vote = {
  poll_id: 'p-1',
  option_ids: ['o-1'],
  voter: 'ana@example.com',
};

describe('PollVoteSchema', () => {
  it('accepts a vote', () => {
    const result = PollVoteSchema.safeParse(vote);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual(vote);
    }
  });

  it('rejects duplicate option_ids', () => {
    expect(PollVoteSchema.safeParse({ ...vote, option_ids: ['o-1', 'o-1'] }).success).toBe(false);
  });

  it('rejects an empty option_ids list', () => {
    expect(PollVoteSchema.safeParse({ ...vote, option_ids: [] }).success).toBe(false);
  });

  it('rejects more than 10 option_ids', () => {
    const optionIds = Array.from({ length: 11 }, (_, index) => `o-${index}`);
    expect(PollVoteSchema.safeParse({ ...vote, option_ids: optionIds }).success).toBe(false);
  });

  it('rejects a missing voter', () => {
    expect(
      PollVoteSchema.safeParse({ poll_id: vote.poll_id, option_ids: vote.option_ids }).success,
    ).toBe(false);
  });

  it('rejects an extra key', () => {
    expect(PollVoteSchema.safeParse({ ...vote, extra: true }).success).toBe(false);
  });
});
