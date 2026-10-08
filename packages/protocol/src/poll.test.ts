import { describe, expect, it } from 'vitest';
import { decodeOrThrow, isValid, PollSchema, PollVoteSchema } from './index';

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
    expect(isValid(PollSchema)(poll)).toBe(true);
    expect(decodeOrThrow(PollSchema)(poll)).toEqual(poll);
  });

  it('rejects duplicate option ids', () => {
    expect(
      isValid(PollSchema)({
        ...poll,
        options: [
          { id: 'o-1', label: 'Beach' },
          { id: 'o-1', label: 'Mountains' },
        ],
      }),
    ).toBe(false);
  });

  it('rejects a single option', () => {
    expect(isValid(PollSchema)({ ...poll, options: [{ id: 'o-1', label: 'Beach' }] })).toBe(false);
  });

  it('rejects more than 10 options', () => {
    const options = Array.from({ length: 11 }, (_, index) => ({
      id: `o-${index}`,
      label: `Option ${index}`,
    }));
    expect(isValid(PollSchema)({ ...poll, options })).toBe(false);
  });

  it('rejects an empty option label', () => {
    expect(
      isValid(PollSchema)({
        ...poll,
        options: [
          { id: 'o-1', label: '' },
          { id: 'o-2', label: 'Mountains' },
        ],
      }),
    ).toBe(false);
  });

  it('rejects an extra key on an option', () => {
    expect(
      isValid(PollSchema)({
        ...poll,
        options: [
          { id: 'o-1', label: 'Beach', extra: true },
          { id: 'o-2', label: 'Mountains' },
        ],
      }),
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
    expect(isValid(PollVoteSchema)(vote)).toBe(true);
    expect(decodeOrThrow(PollVoteSchema)(vote)).toEqual(vote);
  });

  it('rejects duplicate option_ids', () => {
    expect(isValid(PollVoteSchema)({ ...vote, option_ids: ['o-1', 'o-1'] })).toBe(false);
  });

  it('rejects an empty option_ids list', () => {
    expect(isValid(PollVoteSchema)({ ...vote, option_ids: [] })).toBe(false);
  });

  it('rejects more than 10 option_ids', () => {
    const optionIds = Array.from({ length: 11 }, (_, index) => `o-${index}`);
    expect(isValid(PollVoteSchema)({ ...vote, option_ids: optionIds })).toBe(false);
  });

  it('rejects a missing voter', () => {
    expect(isValid(PollVoteSchema)({ poll_id: vote.poll_id, option_ids: vote.option_ids })).toBe(
      false,
    );
  });

  it('rejects an extra key', () => {
    expect(isValid(PollVoteSchema)({ ...vote, extra: true })).toBe(false);
  });
});
