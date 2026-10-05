import { describe, expect, it } from 'vitest';

import { safeLinkTarget } from './links';

describe('safeLinkTarget', () => {
  it('accepts http and https URLs', () => {
    expect(safeLinkTarget('https://x.com/a')).toBe('https://x.com/a');
    expect(safeLinkTarget('http://x.com/a')).toBe('http://x.com/a');
  });

  it('refuses every other scheme', () => {
    expect(safeLinkTarget('javascript:alert(1)')).toBeUndefined();
    expect(safeLinkTarget('data:text/html,<h1>hi</h1>')).toBeUndefined();
    expect(safeLinkTarget('vbscript:msgbox(1)')).toBeUndefined();
    expect(safeLinkTarget('file:///etc/passwd')).toBeUndefined();
    expect(safeLinkTarget('www.x.com')).toBeUndefined();
  });
});
