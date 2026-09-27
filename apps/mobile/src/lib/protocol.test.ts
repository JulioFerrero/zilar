import { describe, expect, it } from 'vitest';

import { protocolLabel } from './protocol';

describe('protocolLabel', () => {
  it('prefixes the version with "protocol v"', () => {
    expect(protocolLabel('0.1.0')).toBe('protocol v0.1.0');
  });
});
