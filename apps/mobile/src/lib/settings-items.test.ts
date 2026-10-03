import { describe, expect, it } from 'vitest';

import { SETTINGS_ITEMS } from './settings-items';

describe('SETTINGS_ITEMS', () => {
  it('lists Profile first, My AIs second and Contact requests third, with routes', () => {
    expect(SETTINGS_ITEMS.map((item) => item.id)).toEqual(['profile', 'ais', 'requests']);
    expect(SETTINGS_ITEMS[0]).toMatchObject({ title: 'Profile', href: '/settings/profile' });
    expect(SETTINGS_ITEMS[1]).toMatchObject({ title: 'My AIs', href: '/ais' });
    expect(SETTINGS_ITEMS[2]).toMatchObject({
      title: 'Contact requests',
      href: '/settings/requests',
    });
  });

  it('gives every row a title, a subtitle, an icon id and a route', () => {
    for (const item of SETTINGS_ITEMS) {
      expect(item.title).not.toBe('');
      expect(item.subtitle).not.toBe('');
      expect(['profile', 'ai', 'requests']).toContain(item.icon);
      expect(item.href.startsWith('/')).toBe(true);
    }
  });

  it('keeps row ids unique', () => {
    const ids = SETTINGS_ITEMS.map((item) => item.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
