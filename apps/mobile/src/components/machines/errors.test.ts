import { describe, expect, it } from 'vitest';

import { MachinesApiError } from '@/lib/machines-api';
import { describeMachinesError } from './errors';

// A raw server message no user-facing text may ever repeat back.
const RAW = 'raw server text: invalid_transition on machine m-9';

describe('describeMachinesError', () => {
  it('maps known codes to fixed sentences', () => {
    expect(
      describeMachinesError(new MachinesApiError(404, 'not_found', RAW), 'Fallback.').message,
    ).toBe('That machine no longer exists.');
    expect(
      describeMachinesError(new MachinesApiError(409, 'revoke_first', RAW), 'Fallback.').message,
    ).toBe('Revoke the machine before deleting it.');
    expect(
      describeMachinesError(new MachinesApiError(409, 'invalid_transition', RAW), 'Fallback.')
        .message,
    ).toBe('That machine changed. Reload the list and try again.');
  });

  it('answers the fallback, never raw text, for an unmapped code', () => {
    const message = describeMachinesError(
      new MachinesApiError(503, 'something_new', RAW),
      'Could not load your machines.',
    ).message;
    expect(message).toBe('Could not load your machines.');
    expect(message).not.toContain('raw server text');
  });
});
