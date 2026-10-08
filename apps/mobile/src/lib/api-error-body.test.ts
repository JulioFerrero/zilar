import { describe, expect, it } from 'vitest';

import { errorFieldsOf } from './api-error-body';

describe('errorFieldsOf', () => {
  it('keeps both fields of a valid envelope', () => {
    expect(errorFieldsOf({ error: { code: 'invalid_request', message: 'Bad query' } })).toEqual({
      code: 'invalid_request',
      message: 'Bad query',
    });
  });

  it('keeps a valid message when the code has the wrong type', () => {
    expect(errorFieldsOf({ error: { code: 123, message: 'Bad query' } })).toEqual({
      message: 'Bad query',
    });
  });

  it('keeps a valid code when the message has the wrong type', () => {
    expect(errorFieldsOf({ error: { code: 'invalid_request', message: 123 } })).toEqual({
      code: 'invalid_request',
    });
  });

  it('gives both fields undefined when error is missing', () => {
    expect(errorFieldsOf({})).toEqual({});
  });

  it('gives both fields undefined when error is not an object', () => {
    expect(errorFieldsOf({ error: 'nope' })).toEqual({});
  });

  it('gives both fields undefined for a non-JSON or null body', () => {
    expect(errorFieldsOf(null)).toEqual({});
    expect(errorFieldsOf('not-json')).toEqual({});
  });
});
