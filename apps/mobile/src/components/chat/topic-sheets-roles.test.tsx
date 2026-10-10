import { createElement } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

import { TopicInfoSheet } from './topic-sheets';
import type { ChatSummary } from '@/lib/types';

vi.mock('react-native', () => ({
  ActivityIndicator: 'ActivityIndicator',
  Modal: 'Modal',
  Platform: { OS: 'ios', select: (options: Record<string, unknown>) => options['ios'] },
  Pressable: 'Pressable',
  View: 'View',
}));

vi.mock('lucide-react-native', () => ({
  Check: 'Check',
  Lock: 'Lock',
  CircleAlert: 'CircleAlert',
  Inbox: 'Inbox',
}));

vi.mock('@/components/chat/avatar', () => ({
  Avatar: 'Avatar',
}));

// The info sheet renders through the kit `BottomSheet` (T-0315); stub it
// as a host tag so the rows render under `renderToStaticMarkup`. The real
// shell is covered by `bottom-sheet.test.tsx`.
vi.mock('@/components/ui/bottom-sheet', () => ({
  BottomSheet: 'BottomSheet',
}));

// `@/lib/roles` is deliberately NOT mocked: the render assertions below
// verify the real label/line wiring (T-0137 pre-review finding 3). The
// module is types-only apart from pure functions, so it loads cleanly.

vi.mock('@/lib/colors', () => ({
  DANGER: { dark: '#ef4444', light: '#ef4444' },
  FOREGROUND: '#fafafa',
  MUTED_FOREGROUND: '#8a8a8a',
}));

function chat(visibility: 'public' | 'private'): ChatSummary {
  return {
    id: 't-hiring',
    title: 'Hiring: frontend role',
    kind: 'group',
    isAI: false,
    space: 'work',
    unread: 0,
    muted: false,
    memberCount: 2,
    groupId: 'g-devteam',
    groupTitle: 'Dev team',
    topic: {
      id: 't-devteam-hiring',
      glyph: 'H',
      kind: 'task',
      status: 'blocked',
      visibility,
      isGeneral: false,
      archived: false,
      owner: null,
      linkUrl: null,
      linkLabel: null,
    },
  };
}

const ATTACHED = [{ id: 'r1', name: 'Designers', memberCount: 2 }];

const GROUP_ROLES = [
  {
    id: 'r1',
    name: 'Designers',
    members: [
      { userId: 'me', name: 'You' },
      { userId: 'ana', name: 'Ana' },
    ],
  },
  { id: 'r2', name: 'Devs', members: [{ userId: 'me', name: 'You' }] },
];

function sheet(overrides: Record<string, unknown> = {}): string {
  return renderToStaticMarkup(
    createElement(TopicInfoSheet, {
      chat: chat('private'),
      groupTitle: 'Dev team',
      members: [
        { userId: 'me', name: 'You' },
        { userId: 'ana', name: 'Ana' },
      ],
      ais: [],
      aiCount: 0,
      canArchive: false,
      isMember: true,
      busy: false,
      error: '',
      onLeave: () => {},
      onArchive: () => {},
      onClose: () => {},
      roles: ATTACHED,
      rolesError: '',
      rolesLoading: false,
      groupRolesError: '',
      approverRole: null,
      groupRoles: GROUP_ROLES,
      canManageRoles: true,
      onToggleTopicRole: () => {},
      onPickApprover: () => {},
      onRetryRoles: () => {},
      onRetryGroupRoles: () => {},
      ...overrides,
    }),
  );
}

describe('TopicInfoSheet roles (T-0137)', () => {
  it('shows attached roles with counts and the manager controls on private topics', () => {
    const html = sheet();
    expect(html).toContain('Designers (2)');
    expect(html).toContain('Add roles');
    expect(html).toContain('Remove');
    expect(html).toContain('Approvers');
  });

  it('hides every write control from non-managers but keeps the list', () => {
    const html = sheet({
      canManageRoles: false,
      approverRole: { id: 'r1', name: 'Designers' },
    });
    expect(html).toContain('Designers (2)');
    expect(html).toContain('Approvers: Designers');
    expect(html).not.toContain('Add roles');
    expect(html).not.toContain('Remove');
  });

  it('shows no role controls on public topics, and says so', () => {
    const html = sheet({ chat: chat('public') });
    expect(html).toContain('Roles are only available on private topics.');
    expect(html).not.toContain('Add roles');
    expect(html).not.toContain('Designers (2)');
  });

  it('shows the loading error with a Retry', () => {
    const html = sheet({ rolesError: 'Could not load the roles. Try again.' });
    expect(html).toContain('Could not load the roles. Try again.');
    expect(html).toContain('Retry');
  });

  it('says the controls are loading while the manager bit resolves', () => {
    const html = sheet({ rolesLoading: true });
    expect(html).toContain('Checking your role…');
    expect(html).not.toContain('Add roles');
    expect(html).not.toContain('Remove');
  });

  it('names a group-roles load failure with a Retry instead of degrading silently', () => {
    const html = sheet({ groupRolesError: 'Could not load the group roles. Try again.' });
    expect(html).toContain('Could not load the group roles. Try again.');
    expect(html).toContain('Retry');
  });

  it('fails loudly if the label wiring breaks', async () => {
    // The `@/lib/roles` import above is real, so importing this test with a
    // broken `topicRoleLabel`/`approverLine` (or a changed confirm copy)
    // fails here too — the suite no longer passes for the wrong reason.
    const real = await import('@/lib/roles');
    expect(real.topicRoleLabel({ id: 'r1', name: 'Designers', memberCount: 2 })).toBe(
      'Designers (2)',
    );
    expect(real.approverLine({ id: 'r1', name: 'Designers' })).toBe('Approvers: Designers');
    expect(sheet()).toContain('Designers (2)');
    expect(
      sheet({ canManageRoles: false, approverRole: { id: 'r1', name: 'Designers' } }),
    ).toContain('Approvers: Designers');
  });

  it('offers the Add-roles picker entry when group roles are addable', () => {
    // The picker itself opens on tap (not covered statically); the rows it
    // shows come from `topicAccessRows`, pinned sorted by the unit tests.
    const html = sheet({
      roles: [],
      groupRoles: [
        { id: 'r2', name: 'Zebras', members: [{ userId: 'me', name: 'You' }] },
        { id: 'r1', name: 'Designers', members: [{ userId: 'me', name: 'You' }] },
      ],
    });
    expect(html).toContain('Add roles');
    expect(html).toContain('No roles here yet');
  });
});
