import { describe, expect, it } from 'vitest';
import { apiErrorFromBody } from './errors';

describe('apiErrorFromBody', () => {
  it('keeps a valid code when the message is malformed, and the reverse', () => {
    expect(apiErrorFromBody(403, { error: { code: 'locked', message: 123 } })).toMatchObject({
      code: 'locked',
      message: 'Request failed (403)',
    });
    expect(apiErrorFromBody(403, { error: { code: 123, message: 'Nope' } })).toMatchObject({
      code: 'request_failed',
      message: 'Nope',
    });
  });

  it('falls back on both fields when the body is not an envelope', () => {
    expect(apiErrorFromBody(500, null)).toMatchObject({
      code: 'request_failed',
      message: 'Request failed (500)',
    });
    expect(apiErrorFromBody(500, { error: 'boom' })).toMatchObject({ code: 'request_failed' });
  });
});
