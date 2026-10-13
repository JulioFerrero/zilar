import { describe, expect, it } from 'vitest';

import { nameSeed } from './avatar-seed';

describe('nameSeed', () => {
  it('folds case and whitespace so the same name gives the same seed', () => {
    expect(nameSeed('  Ana  María ')).toBe('ana maría');
    expect(nameSeed('  Ana  María ')).toBe(nameSeed('ana maría'));
  });

  it('returns an empty string for an empty or blank name', () => {
    expect(nameSeed('')).toBe('');
    expect(nameSeed('   ')).toBe('');
  });

  it('does not throw on a lone surrogate', () => {
    expect(() => nameSeed('\uD800')).not.toThrow();
    expect(nameSeed('\uD800')).toBe('\uFFFD');
  });
});
