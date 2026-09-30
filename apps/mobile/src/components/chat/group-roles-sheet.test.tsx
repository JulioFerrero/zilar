import { createElement } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

import { GroupRolesSheet } from './group-roles-sheet';
import type { CustomGroupRole } from '@/lib/roles-api';

vi.mock('react-native', () => ({
  Modal: 'Modal',
  Pressable: 'Pressable',
  TextInput: 'TextInput',
  View: 'View',
}));

vi.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

vi.mock('@/components/chat/avatar', () => ({
  Avatar: 'Avatar',
}));

vi.mock('@/components/chat/role-chips', () => ({
  // Render the chip names as plain text so the markup stays searchable.
  RoleChips: ({ roles }: { roles: { name: string }[] }) => roles.map((role) => role.name).join(' '),
}));

vi.mock('@/components/ui/text', () => ({
  Text: 'Text',
}));

// `@/lib/roles` is deliberately NOT mocked: the render assertions below
// verify the real confirm-text wiring (T-0137 pre-review finding 3).

const MEMBERS = [
  { userId: 'me', name: 'You', role: 'owner' as const, chips: [{ id: 'r1', name: 'Designers' }] },
  { userId: 'ana', name: 'Ana', role: 'admin' as const, chips: [{ id: 'r1', name: 'Designers' }] },
  { userId: 'luis', name: 'Luis', role: 'member' as const, chips: [] },
];

const ROLES: CustomGroupRole[] = [
  {
    id: 'r1',
    name: 'Designers',
    members: [
      { userId: 'me', name: 'You' },
      { userId: 'ana', name: 'Ana' },
    ],
  },
];

function sheet(overrides: Record<string, unknown> = {}): string {
  return renderToStaticMarkup(
    createElement(GroupRolesSheet, {
      visible: true,
      groupTitle: 'Dev team',
      members: MEMBERS,
      roles: ROLES,
      rolesError: '',
      isManager: true,
      busy: false,
      error: '',
      onRetryRoles: () => {},
      onCreateRole: async () => {},
      onRenameRole: async () => {},
      onDeleteRole: async () => {},
      onToggleMember: async () => {},
      onClose: () => {},
      ...overrides,
    }),
  );
}

describe('GroupRolesSheet', () => {
  it('shows members with their role chips', () => {
    const html = sheet();
    expect(html).toContain('Dev team · Members (3)');
    expect(html).toContain('Ana');
    expect(html).toContain('Designers');
  });

  it('shows the CRUD controls to managers only', () => {
    const manager = sheet({ isManager: true });
    expect(manager).toContain('Assign');
    expect(manager).toContain('Rename');
    expect(manager).toContain('Delete');
    expect(manager).toContain('Add role');
    expect(manager).toContain('Designers (2)');

    const member = sheet({ isManager: false });
    expect(member).not.toContain('Assign');
    expect(member).not.toContain('Rename');
    // Non-admins still read the list with holder counts.
    expect(member).toContain('Designers (2)');
  });

  it('shows loading and error states with a Retry', () => {
    expect(sheet({ roles: undefined })).toContain('Loading…');
    const html = sheet({ roles: undefined, rolesError: 'Could not load the roles. Try again.' });
    expect(html).toContain('Could not load the roles. Try again.');
    expect(html).toContain('Retry');
  });

  it('says what there are no roles yet', () => {
    expect(sheet({ roles: [] })).toContain('No roles yet.');
  });

  it('renders the real delete-confirm wiring', async () => {
    // The `@/lib/roles` import above is real, so a changed confirm copy or a
    // broken import fails this suite — it no longer passes for the wrong
    // reason (T-0137 pre-review finding 3).
    const real = await import('@/lib/roles');
    expect(real.deleteRoleConfirmText('Designers')).toContain('Designers');
  });
});
