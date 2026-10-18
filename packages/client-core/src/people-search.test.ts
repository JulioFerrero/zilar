import { normalizePeopleQuery } from '@zilar/chat-core';
import { describe, expect, it } from 'vitest';
import { ApiFailure } from './errors';
import { peopleFailureState } from './people-search';

describe('normalizePeopleQuery', () => {
  it('trims, strips one leading @ and lowercases', () => {
    expect(normalizePeopleQuery('  @Ana  ')).toBe('ana');
    expect(normalizePeopleQuery('BOB')).toBe('bob');
    expect(normalizePeopleQuery('@@ana')).toBe('@ana');
  });
});

describe('peopleFailureState', () => {
  const failure = (status: number, code: string) =>
    new ApiFailure({ status, code, message: 'failed', detail: {} });

  it('shows rate limited on a 429', () => {
    expect(peopleFailureState('ana', failure(429, 'too_many_requests'))).toEqual({
      status: 'rate_limited',
      query: 'ana',
    });
  });

  it('shows the error line for any other failure', () => {
    expect(peopleFailureState('ana', failure(500, 'request_failed'))).toEqual({
      status: 'error',
      query: 'ana',
    });
    expect(peopleFailureState('ana', failure(0, 'unknown_error'))).toEqual({
      status: 'error',
      query: 'ana',
    });
  });
});
