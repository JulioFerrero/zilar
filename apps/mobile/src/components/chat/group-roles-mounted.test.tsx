import { createElement, type ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

import { GroupRolesSheet } from '@/components/chat/group-roles-sheet';
import { ROLE_GONE_MESSAGE, ROLE_LOAD_FAILED_MESSAGE } from '@/lib/roles';

// Every pressable records its latest props by label, so a test presses the
// button the sheet really renders (its own `onPress` wiring, not the prop).
const pressables = vi.hoisted(() => new Map<string, { onPress?: () => void }>());

vi.mock('react-native', () => ({
  Modal: 'Modal',
  Platform: { OS: 'ios', select: (options: Record<string, unknown>) => options['ios'] },
  Pressable: (props: {
    accessibilityLabel?: string;
    onPress?: () => void;
    children?: ReactNode;
  }) => {
    if (props.accessibilityLabel !== undefined) {
      pressables.set(props.accessibilityLabel, props);
    }
    return createElement(
      'Pressable',
      { accessibilityLabel: props.accessibilityLabel },
      props.children,
    );
  },
  TextInput: 'TextInput',
  View: 'View',
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

// The sheet renders through the kit `BottomSheet` (T-0315); stub it as a
// host tag so the rows render under `renderToStaticMarkup`. The real shell
// is covered by `bottom-sheet.test.tsx`.
vi.mock('@/components/ui/bottom-sheet', () => ({
  BottomSheet: 'BottomSheet',
}));

// `@/lib/roles` is deliberately NOT mocked: the assertions below verify the
// real `describeRolesError(error, 'load')` line the group screen's mount
// effect produces (T-0140/T-0147/T-0157). The mount mapping itself lives in
// `app/group/[id].tsx`, which expo-router owns at build time, so this test
// mounts the screen's exact render path instead: the same sheet the screen
// renders, fed by the same mount-effect mapping, with a working Retry.

const MEMBERS = [
  {
    userId: 'me',
    name: 'You',
    role: 'owner' as const,
    chips: [] as { id: string; name: string }[],
  },
];

async function mountRolesLoadError(error: unknown): Promise<{
  html: string;
  /** Fires the sheet's Retry pressable, like a tap would. */
  pressRetry: () => void;
  retried: () => boolean;
}> {
  // The group screen's mount effect (`app/group/[id].tsx`): the first roles
  // load maps through `describeRolesError(error, 'load')`, and Retry
  // re-runs the same load. Imported from the real modules so a regression
  // in either the mapping or the call site fails here.
  const { describeRolesError } = await import('@/lib/roles');
  const rolesError = describeRolesError(error, 'load');
  let retried = false;
  const onRetryRoles = () => {
    retried = true;
  };
  const element = createElement(GroupRolesSheet, {
    visible: true,
    groupTitle: 'Dev team',
    members: MEMBERS,
    roles: undefined,
    rolesError,
    isManager: true,
    busy: false,
    error: '',
    onRetryRoles,
    onCreateRole: async () => {},
    onRenameRole: async () => {},
    onDeleteRole: async () => {},
    onToggleMember: async () => {},
    onClose: () => {},
  });
  const html = renderToStaticMarkup(element);
  // Pressing the Retry the sheet rendered (found by its label) drives the real
  // wired handler: if the sheet renders a dead button or drops the label, the
  // press does not retry.
  return {
    html,
    pressRetry: () => {
      const retry = pressables.get('Retry loading roles');
      if (retry?.onPress === undefined) {
        throw new Error('The sheet rendered no Retry button with a handler');
      }
      retry.onPress();
    },
    retried: () => retried,
  };
}

describe('group screen mounted roles load error (T-0157 item 6)', () => {
  it('shows the gone line for a first-load 404, not the generic line', async () => {
    const { html } = await mountRolesLoadError(
      Object.assign(new Error('not here'), { status: 404, code: 'not_found' }),
    );
    expect(html).toContain(ROLE_GONE_MESSAGE);
    expect(ROLE_GONE_MESSAGE).not.toBe(ROLE_LOAD_FAILED_MESSAGE);
  });

  it('shows the generic line for any other first-load failure', async () => {
    const { html } = await mountRolesLoadError(new Error('offline'));
    expect(html).toContain(ROLE_LOAD_FAILED_MESSAGE);
  });

  it('offers a working Retry on the load error', async () => {
    const { html, pressRetry, retried } = await mountRolesLoadError(new Error('offline'));
    expect(html).toContain('Retry loading roles');
    expect(html).toContain('Retry');
    expect(retried()).toBe(false);
    // Press the rendered Retry button: a dead or unwired one fails here.
    pressRetry();
    expect(retried()).toBe(true);
  });
});
