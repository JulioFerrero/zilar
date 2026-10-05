import { describe, expect, it } from 'vitest';

import { SETTINGS_ITEMS } from '@/lib/settings-items';

import { settingsHubGroups, settingsHubRows } from './hub';

describe('settingsHubRows', () => {
  it('maps every settings item to a hub row with its group', () => {
    const rows = settingsHubRows();

    expect([...rows].map((row) => row.id).sort()).toEqual(
      SETTINGS_ITEMS.map((item) => item.id).sort(),
    );
    for (const row of rows) {
      const item = SETTINGS_ITEMS.find((candidate) => candidate.id === row.id);
      expect(item).toBeDefined();
      expect(row.title).not.toBe('');
      expect(row.subtitle).not.toBe('');
      expect(row.iconTestId).toBe(`settings-icon-${row.icon}`);
      expect(row.accessibilityLabel).toContain(row.title);
      expect(row.href.startsWith('/')).toBe(true);
      expect(row.group).toBe(item?.group);
    }
  });

  it('orders the rows by group', () => {
    expect(settingsHubRows().map((row) => row.group)).toEqual([
      'account',
      'account',
      'account',
      'ais',
      'ais',
      'ais',
      'chats',
      'server',
    ]);
  });
});

describe('settingsHubGroups', () => {
  it('groups the rows in order, one card per group', () => {
    const groups = settingsHubGroups();

    expect(groups.map((group) => group.group)).toEqual(['account', 'ais', 'chats', 'server']);
    const ids = new Map(
      groups.map((group) => [group.group, group.rows.map((row) => row.id)] as const),
    );
    expect(ids.get('account')).toEqual(['profile', 'requests', 'blocked']);
    expect(ids.get('ais')).toEqual(['approvals', 'machines', 'connections']);
    expect(ids.get('chats')).toEqual(['stickers']);
    expect(ids.get('server')).toEqual(['integrations']);
    for (const group of groups) {
      expect(group.label).not.toBe('');
      expect(group.rows.every((row) => row.group === group.group)).toBe(true);
    }
  });
});
