import { describe, expect, it } from 'vitest';

import { SETTINGS_ITEMS } from '@/lib/settings-items';

import { settingsHubRows } from './hub';

describe('settingsHubRows', () => {
  it('maps every settings item to a hub row, in order', () => {
    const rows = settingsHubRows();

    expect(rows.map((row) => row.id)).toEqual(SETTINGS_ITEMS.map((item) => item.id));
    expect(rows.map((row) => row.href)).toEqual(SETTINGS_ITEMS.map((item) => item.href));
    for (const row of rows) {
      expect(row.title).not.toBe('');
      expect(row.subtitle).not.toBe('');
      expect(row.iconTestId).toBe(`settings-icon-${row.icon}`);
      expect(row.accessibilityLabel).toContain(row.title);
      expect(row.href.startsWith('/')).toBe(true);
    }
  });
});
