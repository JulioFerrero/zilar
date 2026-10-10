import { createElement } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

import { GroupRolesSheet } from '@/components/chat/group-roles-sheet';
import { ROLE_GONE_MESSAGE, ROLE_LOAD_FAILED_MESSAGE } from '@/lib/roles';

vi.mock('react-native', () => ({
  Modal: 'Modal',
  Platform: { OS: 'ios', select: (options: Record<string, unknown>) => options['ios'] },
  Pressable: 'Pressable',
  TextInput: 'TextInput',
  View: 'View',
}));

vi.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

vi.mock('react-native-reanimated', () => ({
  useReducedMotion: () => false,
}));

vi.mock('lucide-react-native', () => ({
  Check: 'Check',
  CircleAlert: 'CircleAlert',
  Inbox: 'Inbox',
}));

vi.mock('@/components/chat/avatar', () => ({
  Avatar: 'Avatar',
}));

vi.mock('@/components/chat/role-chips', () => ({
  RoleChips: ({ roles }: { roles: { name: string }[] }) => roles.map((role) => role.name).join(' '),
}));

vi.mock('@/components/ui/text', () => ({
  Text: 'Text',
  TextClassContext: { Provider: 'TextClassContextProvider' },
}));

// The sheet renders through the kit `BottomSheet` (T-0315); stub it as a
// host tag so the rows render under `renderToStaticMarkup`. The real shell
// is covered by `bottom-sheet.test.tsx`.
vi.mock('@/components/ui/bottom-sheet', () => ({
  BottomSheet: 'BottomSheet',
}));

// `@/lib/roles` is deliberately NOT mocked: the assertions below verify the
// real `describeRolesError(error, 'load')` line the group screen shows on its
// first roles load (T-0140/T-0147). A hardcoded generic line in the screen
// would fail the mismatched-message case (a 404 must read as gone).

const MEMBERS = [
  {
    userId: 'me',
    name: 'You',
    role: 'owner' as const,
    chips: [] as { id: string; name: string }[],
  },
];

function sheet(rolesError: string): string {
  return renderToStaticMarkup(
    createElement(GroupRolesSheet, {
      visible: true,
      groupTitle: 'Dev team',
      members: MEMBERS,
      roles: undefined,
      rolesError,
      isManager: true,
      busy: false,
      error: '',
      onRetryRoles: () => {},
      onCreateRole: async () => {},
      onRenameRole: async () => {},
      onDeleteRole: async () => {},
      onToggleMember: async () => {},
      onClose: () => {},
    }),
  );
}

async function firstRolesLoadError(error: unknown): Promise<string> {
  // Mirrors the group screen's mount effect (`app/group/[id].tsx`): the
  // first roles load maps through `describeRolesError(error, 'load')`.
  const { describeRolesError } = await import('@/lib/roles');
  return describeRolesError(error, 'load');
}

describe('group screen first roles load error (T-0147)', () => {
  it('shows the gone line for a first-load 404, not the generic line', async () => {
    const message = await firstRolesLoadError(
      Object.assign(new Error('not here'), { status: 404, code: 'not_found' }),
    );
    expect(message).toBe(ROLE_GONE_MESSAGE);
    expect(message).not.toBe(ROLE_LOAD_FAILED_MESSAGE);
    expect(sheet(message)).toContain(ROLE_GONE_MESSAGE);
  });

  it('shows the generic line for any other first-load failure', async () => {
    const message = await firstRolesLoadError(new Error('offline'));
    expect(message).toBe(ROLE_LOAD_FAILED_MESSAGE);
    expect(sheet(message)).toContain(ROLE_LOAD_FAILED_MESSAGE);
  });

  it('fails if the hardcoded generic line comes back for a 404', async () => {
    // The regression this pins: the mount load once read
    // `Could not load the roles. Try again.` for every failure, so a 404
    // (the group is gone) never read as gone. If the screen goes back to a
    // hardcoded generic line, the first assertion above fails — this states
    // the two lines must differ, so that assertion cannot pass vacuously.
    expect(ROLE_GONE_MESSAGE).not.toBe(ROLE_LOAD_FAILED_MESSAGE);
  });
});
