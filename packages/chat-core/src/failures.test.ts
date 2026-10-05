import { describe, expect, it } from 'vitest';
import { sendFailureLabel } from './failures';
import type { SendFailureReason } from './types';

describe('sendFailureLabel', () => {
  it('maps every reason to a fixed user-safe string', () => {
    const reasons: SendFailureReason[] = [
      'too_large',
      'unsupported_file',
      'server_unavailable',
      'upload_refused',
      'network',
      'timed_out',
    ];
    expect(reasons.map(sendFailureLabel)).toEqual([
      'File too large to send',
      'File type not supported',
      'Server unavailable',
      'Upload refused',
      'Network error',
      'Timed out',
    ]);
  });
});
