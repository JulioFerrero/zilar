import { describe, expect, it } from 'vitest';

import { IntegrationsApiError } from '../../lib/integrations-api';
import { describeIntegrationsError } from './errors';

function apiError(code: string): IntegrationsApiError {
  return new IntegrationsApiError(422, code, 'server text must never leak');
}

describe('describeIntegrationsError', () => {
  it.each([
    ['invalid_token', 'Telegram rejected the bot token. Check it and try again.'],
    [
      'mail_send_failed',
      'The test email could not be sent. Check the Resend key and the sender address.',
    ],
    ['managed_by_environment', 'This is managed by environment variables on this server.'],
    ['endpoint_unreachable', 'The transcription endpoint could not be reached. Check the URL.'],
    [
      'endpoint_rejected',
      'The transcription endpoint rejected the test request. Check the URL, key and model.',
    ],
    ['rate_limited', 'Too many tries. Wait a little and try again.'],
    ['network_error', 'Could not reach the server.'],
  ])('maps %s to a fixed sentence', (code, sentence) => {
    expect(describeIntegrationsError(apiError(code), 'Could not save. Try again.')).toBe(sentence);
  });

  it('answers unknown codes with the caller fallback, never the server text', () => {
    const message = describeIntegrationsError(
      apiError('weird_new_code'),
      'Could not save. Try again.',
    );
    expect(message).toBe('Could not save. Try again.');
    expect(message).not.toContain('server text');
  });

  it('answers non-API failures with the caller fallback', () => {
    expect(describeIntegrationsError(new Error('boom'), 'Could not remove it. Try again.')).toBe(
      'Could not remove it. Try again.',
    );
    expect(describeIntegrationsError(null, 'Could not save. Try again.')).toBe(
      'Could not save. Try again.',
    );
  });
});
