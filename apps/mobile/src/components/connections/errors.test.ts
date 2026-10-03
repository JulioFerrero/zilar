import { describe, expect, it } from 'vitest';

import { ConnectionsApiError } from '@/lib/connections-api';
import { describeConnectionsError } from './errors';

// A raw server message no user-facing text may ever repeat back.
const RAW = 'raw server text: key_unreadable on connection c-9';

describe('describeConnectionsError', () => {
  it('maps known codes to fixed sentences', () => {
    expect(
      describeConnectionsError(new ConnectionsApiError(404, 'not_found', RAW), 'Fallback.').message,
    ).toBe('That connection no longer exists.');
    expect(
      describeConnectionsError(new ConnectionsApiError(409, 'connection_in_use', RAW), 'Fallback.')
        .message,
    ).toBe('An AI still uses this connection. Switch the AI first.');
    expect(
      describeConnectionsError(new ConnectionsApiError(500, 'key_unreadable', RAW), 'Fallback.')
        .message,
    ).toBe('The stored key could not be read. Remove it and add it again.');
    expect(
      describeConnectionsError(
        new ConnectionsApiError(503, 'connections_unavailable', RAW),
        'Fallback.',
      ).message,
    ).toBe('Connections are not set up on this server.');
  });

  it('answers the fallback, never raw text, for an unmapped code', () => {
    const message = describeConnectionsError(
      new ConnectionsApiError(503, 'something_new', RAW),
      'Could not load your connections.',
    ).message;
    expect(message).toBe('Could not load your connections.');
    expect(message).not.toContain('raw server text');
  });
});
