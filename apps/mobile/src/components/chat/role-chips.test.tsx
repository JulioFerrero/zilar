import { createElement } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

import { RoleChips } from './role-chips';

vi.mock('react-native', () => ({
  View: 'View',
}));

vi.mock('@/components/ui/text', () => ({
  Text: 'Text',
}));

vi.mock('@/lib/utils', () => ({
  cn: (...parts: unknown[]) => parts.filter(Boolean).join(' '),
}));

describe('RoleChips', () => {
  it('renders one chip per role with its name', () => {
    const html = renderToStaticMarkup(
      createElement(RoleChips, {
        roles: [
          { id: 'r1', name: 'Designers' },
          { id: 'r2', name: 'Devs' },
        ],
      }),
    );
    expect(html).toContain('Designers');
    expect(html).toContain('Devs');
    expect(html).toContain('Role Designers');
  });

  it('renders nothing without roles', () => {
    const html = renderToStaticMarkup(createElement(RoleChips, { roles: [] }));
    expect(html).toBe('');
  });
});
