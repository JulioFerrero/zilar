import { describe, expect, it } from 'vitest';

import { connectionLabel } from './connection';

describe('connectionLabel', () => {
  it('shows the connecting bar while not online', () => {
    expect(connectionLabel('connecting')).toBe('Connecting…');
    expect(connectionLabel('reconnecting')).toBe('Connecting…');
    expect(connectionLabel('offline')).toBe('Waiting for network…');
  });

  it('hides the bar when online', () => {
    expect(connectionLabel('online')).toBeUndefined();
  });
});
