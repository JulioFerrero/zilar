import { describe, expect, it } from 'vitest';

import { SETTINGS_GROUP_ORDER, SETTINGS_ITEMS, type SettingsGroup } from './settings-items';

const EXPECTED_GROUPS: Record<string, SettingsGroup> = {
  profile: 'account',
  requests: 'account',
  blocked: 'account',
  approvals: 'ais',
  machines: 'ais',
  connections: 'ais',
  stickers: 'chats',
  integrations: 'server',
};

describe('SETTINGS_ITEMS', () => {
  it('starts with Profile and has no My AIs row', () => {
    expect(SETTINGS_ITEMS[0]).toMatchObject({ title: 'Profile', href: '/settings/profile' });
    expect(SETTINGS_ITEMS.some((item) => item.id === 'profile')).toBe(true);
    expect(SETTINGS_ITEMS.map((item) => item.id as string)).not.toContain('ais');
  });

  it('gives every row a title, a subtitle, an icon id and a route', () => {
    for (const item of SETTINGS_ITEMS) {
      expect(item.title).not.toBe('');
      expect(item.subtitle).not.toBe('');
      expect(item.icon).not.toBe('');
      expect(item.href.startsWith('/')).toBe(true);
    }
  });

  it('gives every row the agreed group', () => {
    expect(SETTINGS_GROUP_ORDER).toEqual(['account', 'ais', 'chats', 'server']);
    for (const item of SETTINGS_ITEMS) {
      expect(SETTINGS_GROUP_ORDER).toContain(item.group);
      expect(item.group).toBe(EXPECTED_GROUPS[item.id]);
    }
  });

  it('adds Blocked people to Account', () => {
    const blocked = SETTINGS_ITEMS.find((item) => item.id === 'blocked');
    expect(blocked).toMatchObject({
      title: 'Blocked people',
      subtitle: 'People you blocked. They are not told.',
      icon: 'blocked',
      href: '/settings/blocked',
      group: 'account',
    });
  });

  it('keeps row ids and routes unique', () => {
    const ids = SETTINGS_ITEMS.map((item) => item.id);
    const routes = SETTINGS_ITEMS.map((item) => item.href);
    expect(new Set(ids).size).toBe(ids.length);
    expect(new Set(routes).size).toBe(routes.length);
  });
});
