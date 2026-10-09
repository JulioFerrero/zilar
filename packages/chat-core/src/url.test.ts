import { describe, expect, it } from 'vitest';
import { parseUrl, safeDecode } from './url';

describe('parseUrl', () => {
  it('parses an absolute URL', () => {
    expect(parseUrl('https://x.com/a?b=1')?.href).toBe('https://x.com/a?b=1');
  });

  it('returns undefined for an invalid input', () => {
    expect(parseUrl('not a url')).toBeUndefined();
    expect(parseUrl('')).toBeUndefined();
  });

  it('returns undefined for a relative URL', () => {
    expect(parseUrl('/api/avatars/1')).toBeUndefined();
  });
});

describe('safeDecode', () => {
  it('decodes a valid percent sequence', () => {
    expect(safeDecode('room%20one%2Ftwo')).toBe('room one/two');
  });

  it('returns the input unchanged when the percent sequence is broken', () => {
    expect(safeDecode('100%')).toBe('100%');
    expect(safeDecode('%E0%A4%A')).toBe('%E0%A4%A');
  });
});
