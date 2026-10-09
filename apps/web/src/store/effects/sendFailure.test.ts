import { describe, expect, it } from 'vitest';
import { sendFailureReasonFor } from './sendFailure';

describe('sendFailureReasonFor', () => {
  it('is always network when offline', () => {
    expect(sendFailureReasonFor({ code: 'too_large' }, true)).toBe('network');
  });

  it('maps the typed codes of the voice and attachment ports', () => {
    expect(sendFailureReasonFor({ code: 'too_large' }, false)).toBe('too_large');
    expect(sendFailureReasonFor({ code: 'voice_empty' }, false)).toBe('unsupported_file');
    expect(sendFailureReasonFor({ code: 'convert_failed' }, false)).toBe('server_unavailable');
    expect(sendFailureReasonFor({ code: 'voice_other' }, false)).toBe('server_unavailable');
    expect(sendFailureReasonFor({ code: 'upload_refused' }, false)).toBe('upload_refused');
    expect(sendFailureReasonFor({ code: 'timed_out' }, false)).toBe('timed_out');
    expect(sendFailureReasonFor({ code: 'network_error' }, false)).toBe('network');
  });

  it('maps an HTTP status when there is no code', () => {
    expect(sendFailureReasonFor({ status: 413 }, false)).toBe('too_large');
    expect(sendFailureReasonFor({ status: 415 }, false)).toBe('unsupported_file');
    expect(sendFailureReasonFor({ status: 403 }, false)).toBe('upload_refused');
    expect(sendFailureReasonFor({ status: 503 }, false)).toBe('server_unavailable');
    expect(sendFailureReasonFor({ status: 400 }, false)).toBe('network');
  });

  it('reads a timeout from the message and falls back to network', () => {
    expect(sendFailureReasonFor(new Error('request timed out'), false)).toBe('timed_out');
    expect(sendFailureReasonFor(new Error('boom'), false)).toBe('network');
    expect(sendFailureReasonFor('boom', false)).toBe('network');
  });
});
