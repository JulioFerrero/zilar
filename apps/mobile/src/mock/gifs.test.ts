import { describe, expect, it } from 'vitest';

import { mockDemoGifs } from './gifs';

/** Mock GIFs must be sendable: ids, titles, dims and app-made art only. */
describe('mock gifs (T-0148)', () => {
  it('serves a few placeholder GIFs without a server', () => {
    const items = mockDemoGifs();
    expect(items.length).toBeGreaterThanOrEqual(3);
    for (const item of items) {
      expect(item.id).not.toBe('');
      expect(item.title).not.toBe('');
      expect(item.url.startsWith('data:image/')).toBe(true);
      expect(item.url).not.toContain('giphy');
      expect(item.width).toBeGreaterThan(0);
      expect(item.height).toBeGreaterThan(0);
    }
  });

  it('rebuilds per call so tests cannot share mutable rows', () => {
    expect(mockDemoGifs()).not.toBe(mockDemoGifs());
  });
});
