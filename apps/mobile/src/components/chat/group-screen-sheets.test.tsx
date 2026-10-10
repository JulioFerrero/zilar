// @vitest-environment jsdom
import { createRequire } from 'node:module';
import { act, createElement, useState, type ReactNode } from 'react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import GroupTopicsScreen from '@/app/group/[id]';
import { ROLE_GONE_MESSAGE, ROLE_LOAD_FAILED_MESSAGE } from '@/lib/roles';
import { settle } from '@/test/wait';

// The group screen (`app/group/[id].tsx`) is mounted for real in jsdom with
// its sheets replaced by stubs that expose the props the screen hands them.
// This covers two rules that used to be pinned in the screen source: the first
// roles load maps its error through the load wording, and the new-topic sheet
// is remounted on every open so it keeps no previous name.
const nodeRequire = createRequire(import.meta.url);
const { createRoot } = nodeRequire('react-dom/client') as {
  createRoot: (container: Element) => { render(node: ReactNode): void; unmount(): void };
};

type Kids = { children?: ReactNode };

const mocks = vi.hoisted(() => ({
  state: {} as Record<string, unknown>,
  rolesSheet: undefined as undefined | { rolesError: string; onRetryRoles: () => void },
  topicSheetMounts: 0,
  // One router object for every render: the screen lists it as an effect dep.
  router: { back: vi.fn(), push: vi.fn(), replace: vi.fn() },
  // Same for the directory API: a fresh object per render loops its query.
  directory: { api: {} },
}));

vi.mock('expo-clipboard', () => ({ setStringAsync: vi.fn() }));

vi.mock('expo-router', () => ({
  useLocalSearchParams: () => ({ id: 'g-1' }),
  useRouter: () => mocks.router,
}));

vi.mock('lucide-react-native', () => ({
  Archive: 'svg',
  ChevronLeft: 'svg',
  Eye: 'svg',
  Link2: 'svg',
  Plus: 'svg',
  Users: 'svg',
}));

vi.mock('react-native', () => ({
  FlatList: ({ ListEmptyComponent }: { ListEmptyComponent?: ReactNode }) =>
    createElement('div', null, ListEmptyComponent),
  Pressable: ({
    children,
    accessibilityLabel,
    onPress,
  }: Kids & { accessibilityLabel?: string; onPress?: () => void }) =>
    createElement(
      'button',
      { type: 'button', 'aria-label': accessibilityLabel, onClick: onPress },
      children,
    ),
  Share: { share: vi.fn() },
  View: 'div',
}));

vi.mock('react-native-safe-area-context', () => ({
  SafeAreaView: ({ children }: Kids) => createElement('div', null, children),
}));

vi.mock('@/auth/RequireAuth', () => ({ RequireAuth: ({ children }: Kids) => children }));
vi.mock('@/components/chat/avatar', () => ({ Avatar: () => null }));
vi.mock('@/components/chat/channel-screen', () => ({ ChannelScreen: () => null }));
vi.mock('@/components/chat/invite-links-sheet', () => ({ InviteLinksSheet: () => null }));
vi.mock('@/components/chat/topic-sheets', () => ({ TopicActionsSheet: () => null }));
vi.mock('@/components/chat/topic-row', () => ({ TopicRow: () => null }));
vi.mock('@/components/ui/search-field', () => ({ SearchField: () => null }));
vi.mock('@/components/ui/use-key-press', () => ({
  useKeyPress: () => ({ pressed: false, reduceMotion: false, setPressed: () => {} }),
}));

vi.mock('@/components/ui/icon-button', () => ({
  IconButton: ({ label, onPress }: { label: string; onPress: () => void }) =>
    createElement('button', { type: 'button', 'aria-label': label, onClick: onPress }, label),
}));

vi.mock('@/components/ui/text', () => ({
  Text: ({ children }: Kids) => createElement('span', null, children),
}));

vi.mock('@/components/directory/use-directory-api', () => ({
  useDirectoryApi: () => mocks.directory,
}));

vi.mock('@/components/chat/visibility-sheet', () => ({
  mayChangeVisibility: () => false,
  visibilitySaveError: () => '',
  VisibilitySheet: () => null,
}));

vi.mock('@/components/chat/group-roles-sheet', () => ({
  GroupRolesSheet: (props: { rolesError: string; onRetryRoles: () => void }) => {
    mocks.rolesSheet = props;
    return null;
  },
}));

// The stub keeps the typed name in its own state, like the real sheet: only a
// remount (the screen's `key`) clears it.
vi.mock('@/components/chat/new-topic-sheet', () => ({
  NewTopicSheet: ({ visible, onClose }: { visible: boolean; onClose: () => void }) => {
    const [name, setName] = useState(() => {
      mocks.topicSheetMounts += 1;
      return '';
    });
    return visible
      ? createElement(
          'div',
          null,
          createElement('span', { 'data-name': '' }, name),
          createElement(
            'button',
            { type: 'button', 'aria-label': 'Type name', onClick: () => setName('Roadmap') },
            'Type name',
          ),
          createElement(
            'button',
            { type: 'button', 'aria-label': 'Close sheet', onClick: onClose },
            'Close',
          ),
        )
      : null;
  },
}));

vi.mock('@/store/chat-store-provider', () => ({
  useChatStore: (selector: (state: Record<string, unknown>) => unknown) => selector(mocks.state),
}));

const container = document.createElement('div');
let root: ReturnType<typeof createRoot> | undefined;

const GENERAL = {
  id: 'chat-general',
  title: 'General',
  kind: 'group',
  groupId: 'g-1',
  groupTitle: 'Team',
  topic: { id: 't', isGeneral: true, archived: false, status: 'open' },
};

// Stable references: the screen derives memos from what the store returns.
const NO_ROLES: unknown[] = [];

const OWNER_DETAIL = {
  id: 'g-1',
  title: 'Team',
  createdBy: 'me-1',
  membersCanCreateTopics: false,
  members: [{ userId: 'me-1', name: 'Me', role: 'owner', roles: [] }],
  ais: [],
};

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

beforeEach(() => {
  mocks.rolesSheet = undefined;
  mocks.topicSheetMounts = 0;
  Object.assign(mocks.state, {
    chats: [GENERAL],
    chatsLoad: 'loaded',
    ownedAis: [],
    currentUserId: 'me-1',
    topicNotice: undefined,
    groupDetail: () => OWNER_DETAIL,
    groupRoles: () => NO_ROLES,
    ensureGroupDetail: vi.fn(),
    refreshGroupDetail: vi.fn(),
    refreshGroupRoles: vi.fn().mockResolvedValue(undefined),
    createGroupRole: vi.fn(),
    renameGroupRole: vi.fn(),
    deleteGroupRole: vi.fn(),
    setGroupRoleMembers: vi.fn(),
    listInviteLinks: vi.fn().mockResolvedValue([]),
    createInviteLink: vi.fn(),
    revokeInviteLink: vi.fn(),
    createTopic: vi.fn(),
    addTopicAi: vi.fn(),
    archiveTopic: vi.fn(),
    setChatPref: vi.fn(),
    dismissTopicNotice: vi.fn(),
  });
  document.body.appendChild(container);
});

afterEach(async () => {
  if (root !== undefined) {
    const unmounting = root;
    root = undefined;
    await act(async () => unmounting.unmount());
  }
  container.remove();
});

async function mount(): Promise<void> {
  root = createRoot(container);
  const mounted = root;
  await act(async () => {
    mounted.render(createElement(GroupTopicsScreen));
  });
  await settle();
}

function button(label: string): HTMLButtonElement {
  const found = container.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`);
  if (found === null) {
    throw new Error(`no button named ${label}`);
  }
  return found;
}

async function click(label: string): Promise<void> {
  await act(async () => {
    button(label).click();
  });
}

describe('group screen roles load error', () => {
  it('shows the gone line for a first-load 404, not the generic line', async () => {
    mocks.state['refreshGroupRoles'] = vi
      .fn()
      .mockRejectedValue(Object.assign(new Error('not here'), { status: 404, code: 'not_found' }));
    await mount();
    expect(mocks.rolesSheet?.rolesError).toBe(ROLE_GONE_MESSAGE);
  });

  it('shows the generic line for any other first-load failure', async () => {
    mocks.state['refreshGroupRoles'] = vi.fn().mockRejectedValue(new Error('offline'));
    await mount();
    expect(mocks.rolesSheet?.rolesError).toBe(ROLE_LOAD_FAILED_MESSAGE);
  });

  it('clears the line and loads again when the sheet asks for a retry', async () => {
    const refresh = vi
      .fn()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValue(undefined);
    mocks.state['refreshGroupRoles'] = refresh;
    await mount();
    expect(mocks.rolesSheet?.rolesError).toBe(ROLE_LOAD_FAILED_MESSAGE);
    act(() => mocks.rolesSheet?.onRetryRoles());
    await settle();
    expect(refresh).toHaveBeenCalledTimes(2);
    expect(mocks.rolesSheet?.rolesError).toBe('');
  });
});

describe('group screen new-topic sheet', () => {
  it('remounts the sheet on every open, so it keeps no previous name', async () => {
    await mount();
    await click('New topic');
    await click('Type name');
    expect(container.querySelector('[data-name]')?.textContent).toBe('Roadmap');
    await click('Close sheet');
    await click('New topic');
    expect(container.querySelector('[data-name]')?.textContent).toBe('');
    expect(mocks.topicSheetMounts).toBeGreaterThanOrEqual(3);
  });
});
