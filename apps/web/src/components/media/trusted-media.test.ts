import { describe, expect, it } from 'vitest';
import { isTrustedInlineVideoUrl } from './trusted-media';

const HOSTS: ReadonlySet<string> = new Set(['upload.zilar.test', 'zilar.test']);
const NO_HOSTS: ReadonlySet<string> = new Set();

describe('isTrustedInlineVideoUrl', () => {
  it('trusts a same-origin /api/ path with no known hosts', () => {
    expect(isTrustedInlineVideoUrl('/api/files?chat=a&url=b', NO_HOSTS)).toBe(true);
  });

  it('trusts an absolute URL on a media host', () => {
    expect(isTrustedInlineVideoUrl('https://upload.zilar.test/get/1', HOSTS)).toBe(true);
  });

  it('rejects an arbitrary external host', () => {
    expect(isTrustedInlineVideoUrl('https://tracker.example/x.mp4', HOSTS)).toBe(false);
    expect(isTrustedInlineVideoUrl('https://tracker.example/x.mp4', NO_HOSTS)).toBe(false);
  });

  it('rejects a non-http peer URL the file card would not link', () => {
    expect(isTrustedInlineVideoUrl('data:video/mp4;base64,AAAA', HOSTS)).toBe(false);
    expect(isTrustedInlineVideoUrl('blob:https://app.test/abc', HOSTS)).toBe(false);
    expect(isTrustedInlineVideoUrl('javascript:alert(1)', HOSTS)).toBe(false);
  });
});
