import { describe, expect, it } from 'vitest';

import { settingsHubRows } from './hub';

describe('settingsHubRows', () => {
  it('maps every settings item to a hub row', () => {
    const rows = settingsHubRows();

    expect(rows.map((row) => row.id)).toEqual(['profile', 'ais', 'requests']);
    for (const row of rows) {
      expect(row.title).not.toBe('');
      expect(row.subtitle).not.toBe('');
      expect(row.iconTestId).toBe(`settings-icon-${row.icon}`);
      expect(row.accessibilityLabel).toContain(row.title);
      expect(row.href.startsWith('/')).toBe(true);
    }
  });

  it('routes the rows to the settings profile, the AI list and the contact requests', () => {
    const rows = settingsHubRows();

    expect(rows[0]?.href).toBe('/settings/profile');
    expect(rows[1]?.href).toBe('/ais');
    expect(rows[2]?.href).toBe('/settings/requests');
  });
});
