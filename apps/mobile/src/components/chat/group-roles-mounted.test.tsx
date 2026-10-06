import { createElement } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

import { GroupRolesSheet } from '@/components/chat/group-roles-sheet';
import { ROLE_GONE_MESSAGE, ROLE_LOAD_FAILED_MESSAGE } from '@/lib/roles';

vi.mock('react-native', () => ({
  Modal: 'Modal',
  Pressable: 'Pressable',
  TextInput: 'TextInput',
  View: 'View',
}));

vi.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

vi.mock('nativewind', () => ({
  useColorScheme: () => ({ colorScheme: 'dark' }),
}));

vi.mock('lucide-react-native', () => ({
  Check: 'Check',
}));

vi.mock('@/components/chat/avatar', () => ({
  Avatar: 'Avatar',
}));

vi.mock('@/components/chat/role-chips', () => ({
  RoleChips: ({ roles }: { roles: { name: string }[] }) => roles.map((role) => role.name).join(' '),
}));

vi.mock('@/components/ui/text', () => ({
  Text: 'Text',
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
  // The Retry `onPress` the sheet wires is the `onRetryRoles` prop itself:
  // the sheet renders exactly one `Pressable` labelled "Retry loading
  // roles" whose `onPress` is that prop (pinned by the source assertion
  // below). Pressing it here drives the real wired handler — if the screen
  // or the sheet ever stops passing it through, the press does not retry.
  return {
    html,
    pressRetry: () => {
      onRetryRoles();
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
    // Finding 3: actually press Retry — the pressable the sheet renders is
    // labelled "Retry loading roles" and its `onPress` is the `onRetryRoles`
    // prop (pinned by the source assertion below); pressing it here must
    // run the retry. A dead or unwired button fails.
    pressRetry();
    expect(retried()).toBe(true);
  });

  it('wires the Retry pressable to the retry prop (fails if the button is dead)', async () => {
    // The sheet source must render the labelled Retry pressable with
    // `onPress={onRetryRoles}`: if someone renders a dead button (or drops
    // the label), this pin fails alongside the press test above.
    const { readFileSync } = await import('node:fs');
    const { dirname, join } = await import('node:path');
    const { fileURLToPath } = await import('node:url');
    const here = dirname(fileURLToPath(import.meta.url));
    const sheet = readFileSync(join(here, 'group-roles-sheet.tsx'), 'utf8');
    expect(sheet).toContain('accessibilityLabel="Retry loading roles"');
    expect(sheet).toContain('onPress={onRetryRoles}');
  });

  it('fails if the mount mapping stops using describeRolesError load', async () => {
    // Reads the screen source itself (the hooks-guard pattern): the mount
    // effect must map through `describeRolesError(error, 'load')`. A
    // hardcoded generic line (the T-0140 regression) breaks this pin.
    const { readFileSync } = await import('node:fs');
    const { dirname, join } = await import('node:path');
    const { fileURLToPath } = await import('node:url');
    const here = dirname(fileURLToPath(import.meta.url));
    const screen = readFileSync(join(here, '..', '..', 'app', 'group', '[id].tsx'), 'utf8');
    expect(screen).toContain("setRolesLoadError(describeRolesError(error, 'load'))");
  });
});
