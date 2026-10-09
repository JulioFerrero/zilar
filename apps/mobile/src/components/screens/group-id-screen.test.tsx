// @vitest-environment jsdom
import { createRequire } from 'node:module';
import { act, createElement, type ReactNode } from 'react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import GroupTopicsScreen from '@/app/group/[id]';
import type { GroupDetail } from '@/lib/chat-api';
import type { ChatSummary } from '@/lib/types';

// The route is rendered for real in jsdom, so its effects, state and actions
// all run. The chat store, the directory API and the sheets are replaced by
// small stand-ins that expose the props the screen passes. `react-dom/client`
// ships no types here, so it is loaded through a typed require handle (the
// `media-sheet.test.tsx` pattern).
const nodeRequire = createRequire(import.meta.url);
const { createRoot } = nodeRequire('react-dom/client') as {
  createRoot: (container: Element) => { render(node: ReactNode): void; unmount(): void };
};

const mocks = vi.hoisted(() => ({
  router: { back: vi.fn(), push: vi.fn(), replace: vi.fn() },
  setStringAsync: vi.fn(),
  share: vi.fn(),
  directoryApi: {
    getGroupVisibility: vi.fn(),
    setGroupVisibility: vi.fn(),
    checkGroupHandle: vi.fn(),
  },
  // The store state the screen selects from. Filled in `beforeEach`.
  state: {} as Record<string, unknown>,
}));

vi.mock('expo-clipboard', () => ({
  setStringAsync: (text: string) => mocks.setStringAsync(text),
}));

vi.mock('expo-router', () => ({
  useLocalSearchParams: () => ({ id: 'g-1' }),
  useRouter: () => mocks.router,
}));

vi.mock('nativewind', () => ({ useColorScheme: () => ({ colorScheme: 'dark' }) }));

vi.mock('lucide-react-native', () => ({
  Archive: 'svg',
  ChevronLeft: 'svg',
  Eye: 'svg',
  Link2: 'svg',
  Plus: 'svg',
  Users: 'svg',
}));

vi.mock('react-native', async () => {
  const { createElement: h } = await import('react');
  return {
    FlatList: ({
      data,
      renderItem,
      ListEmptyComponent,
      ListFooterComponent,
    }: {
      data: ChatSummary[];
      renderItem: (info: { item: ChatSummary; index: number }) => ReactNode;
      ListEmptyComponent?: ReactNode;
      ListFooterComponent?: ReactNode;
    }) =>
      h(
        'div',
        null,
        data.length === 0
          ? ListEmptyComponent
          : data.map((item, index) => h('div', { key: item.id }, renderItem({ item, index }))),
        ListFooterComponent,
      ),
    Pressable: ({
      children,
      accessibilityLabel,
      onPress,
    }: {
      children?: ReactNode;
      accessibilityLabel?: string;
      onPress?: () => void;
    }) =>
      h('button', { type: 'button', 'aria-label': accessibilityLabel, onClick: onPress }, children),
    Share: { share: (content: unknown) => mocks.share(content) },
    View: 'div',
  };
});

vi.mock('react-native-safe-area-context', async () => {
  const { createElement: h } = await import('react');
  return {
    SafeAreaView: ({ children }: { children?: ReactNode }) => h('div', null, children),
  };
});

vi.mock('@/auth/RequireAuth', () => ({
  RequireAuth: ({ children }: { children: ReactNode }) => children,
}));

vi.mock('@/components/chat/avatar', () => ({ Avatar: () => null }));

vi.mock('@/components/chat/channel-screen', async () => {
  const { createElement: h } = await import('react');
  return {
    ChannelScreen: ({ feedId, title }: { feedId: string; title: string }) =>
      h('div', null, `Channel ${title} feed ${feedId}`),
  };
});

vi.mock('@/components/chat/invite-links-sheet', async () => {
  const { createElement: h } = await import('react');
  return {
    InviteLinksSheet: ({
      visible,
      error,
      createdUrl,
      onCreate,
    }: {
      visible: boolean;
      error: string;
      createdUrl?: string;
      onCreate: (input: { label?: string }) => void;
    }) =>
      visible
        ? h(
            'div',
            null,
            h('p', { role: 'alert' }, error),
            createdUrl === undefined ? null : h('p', null, createdUrl),
            h(
              'button',
              { type: 'button', onClick: () => onCreate({ label: 'Team' }) },
              'Create link',
            ),
          )
        : null,
  };
});

vi.mock('@/components/chat/group-roles-sheet', async () => {
  const { createElement: h } = await import('react');
  return {
    GroupRolesSheet: ({
      visible,
      onCreateRole,
    }: {
      visible: boolean;
      onCreateRole: (name: string) => void;
    }) =>
      visible
        ? h('button', { type: 'button', onClick: () => onCreateRole('Mods') }, 'Create role')
        : null,
  };
});

vi.mock('@/components/chat/visibility-sheet', async () => {
  const { createElement: h } = await import('react');
  return {
    mayChangeVisibility: (role: string | undefined) => role === 'owner',
    visibilitySaveError: () => 'Could not save visibility.',
    VisibilitySheet: ({
      visible,
      error,
      live,
      onPick,
      onHandleChange,
      onSave,
    }: {
      visible: boolean;
      error: string;
      live: { picked: string; typed: string };
      onPick: (visibility: 'public' | 'private') => void;
      onHandleChange: (handle: string) => void;
      onSave: () => void;
    }) =>
      visible
        ? h(
            'div',
            null,
            h('p', { role: 'alert' }, error),
            h('span', null, `Visibility sheet ${live.picked}`),
            h('button', { type: 'button', onClick: () => onPick('public') }, 'Make public'),
            h('input', {
              'aria-label': 'Handle',
              value: live.typed,
              onChange: (event: { target: { value: string } }) =>
                onHandleChange(event.target.value),
            }),
            h('button', { type: 'button', onClick: () => onSave() }, 'Save visibility'),
          )
        : null,
  };
});

vi.mock('@/components/directory/use-directory-api', () => ({
  useDirectoryApi: () => ({ api: mocks.directoryApi }),
}));

vi.mock('@/components/chat/new-topic-sheet', async () => {
  const { createElement: h } = await import('react');
  return {
    NewTopicSheet: ({
      visible,
      error,
      onCreate,
    }: {
      visible: boolean;
      error: string;
      onCreate: (input: {
        name: string;
        kind: string;
        visibility: string;
        memberIds: undefined;
        aiIds: string[];
      }) => void;
    }) =>
      visible
        ? h(
            'div',
            null,
            h('p', { role: 'alert' }, error),
            h(
              'button',
              {
                type: 'button',
                onClick: () =>
                  onCreate({
                    name: 'Planning',
                    kind: 'topic',
                    visibility: 'private',
                    memberIds: undefined,
                    aiIds: ['ai-9'],
                  }),
              },
              'Create topic',
            ),
          )
        : null,
  };
});

vi.mock('@/components/chat/topic-sheets', async () => {
  const { createElement: h } = await import('react');
  return {
    TopicActionsSheet: ({
      chat,
      onAction,
    }: {
      chat: ChatSummary | null;
      onAction: (action: 'archive') => void;
    }) =>
      chat === null
        ? null
        : h('button', { type: 'button', onClick: () => onAction('archive') }, 'Archive topic'),
  };
});

vi.mock('@/components/chat/topic-row', async () => {
  const { createElement: h } = await import('react');
  return {
    TopicRow: ({
      chat,
      onPress,
      onLongPress,
    }: {
      chat: ChatSummary;
      onPress: () => void;
      onLongPress: () => void;
    }) =>
      h(
        'div',
        null,
        h('button', { type: 'button', onClick: onPress }, chat.title),
        h('button', { type: 'button', onClick: onLongPress }, `More ${chat.title}`),
      ),
  };
});

vi.mock('@/components/ui/icon-button', async () => {
  const { createElement: h } = await import('react');
  return {
    IconButton: ({ label, onPress }: { label: string; onPress: () => void }) =>
      h('button', { type: 'button', 'aria-label': label, onClick: onPress }, label),
  };
});

vi.mock('@/components/ui/search-field', async () => {
  const { createElement: h } = await import('react');
  return {
    SearchField: ({
      value,
      onChangeText,
      accessibilityLabel,
    }: {
      value: string;
      onChangeText: (value: string) => void;
      accessibilityLabel?: string;
    }) =>
      h('input', {
        'aria-label': accessibilityLabel,
        value,
        onChange: (event: { target: { value: string } }) => onChangeText(event.target.value),
      }),
  };
});

vi.mock('@/components/ui/text', async () => {
  const { createElement: h } = await import('react');
  return {
    Text: ({ children }: { children?: ReactNode }) => h('span', null, children),
  };
});

vi.mock('@/components/ui/use-key-press', () => ({
  useKeyPress: () => ({ pressed: false, reduceMotion: false, setPressed: () => {} }),
}));

vi.mock('@/store/chat-store-provider', () => ({
  useChatStore: (selector: (state: Record<string, unknown>) => unknown) => selector(mocks.state),
}));

const ME = 'me-1';
const OTHER = 'user-2';

const OWNER_DETAIL: GroupDetail = {
  id: 'g-1',
  title: 'Team',
  createdBy: ME,
  membersCanCreateTopics: false,
  members: [
    { userId: ME, name: 'Me', role: 'owner', roles: [] },
    { userId: OTHER, name: 'Other', role: 'member', roles: [] },
  ],
  ais: [{ aiId: 'ai-9', jid: 'ai-9@zilar.test', name: 'Dev-9', ownerId: ME }],
};

const MEMBER_DETAIL: GroupDetail = {
  ...OWNER_DETAIL,
  members: [
    { userId: ME, name: 'Me', role: 'member', roles: [] },
    { userId: OTHER, name: 'Other', role: 'owner', roles: [] },
  ],
};

type TopicInfo = NonNullable<ChatSummary['topic']>;

function topicInfo(isGeneral: boolean): TopicInfo {
  return {
    id: 'topic',
    glyph: '#',
    kind: 'chat',
    status: 'open',
    visibility: 'private',
    isGeneral,
    archived: false,
    owner: null,
    linkUrl: null,
    linkLabel: null,
  };
}

function topic(id: string, title: string, extra: Partial<ChatSummary> = {}): ChatSummary {
  return {
    id,
    title,
    kind: 'group',
    isAI: false,
    space: 'work',
    unread: 0,
    muted: false,
    groupId: 'g-1',
    groupTitle: 'Team',
    memberCount: 2,
    topic: topicInfo(false),
    ...extra,
  };
}

const GENERAL = topic('chat-general', 'General', { topic: topicInfo(true) });
const PLANNING = topic('chat-planning', 'Planning');

const container = document.createElement('div');
let root: ReturnType<typeof createRoot> | undefined;

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.directoryApi.getGroupVisibility.mockResolvedValue({ visibility: 'private', handle: null });
  mocks.directoryApi.setGroupVisibility.mockResolvedValue(undefined);
  mocks.directoryApi.checkGroupHandle.mockResolvedValue({ available: true });
  Object.assign(mocks.state, {
    chats: [GENERAL, PLANNING],
    chatsLoad: 'loaded',
    detail: OWNER_DETAIL,
    roles: [],
    ownedAis: [{ id: 'ai-9', name: 'Dev-9' }],
    currentUserId: ME,
    topicNotice: undefined,
    groupDetail: () => mocks.state.detail,
    groupRoles: () => mocks.state.roles,
    ensureGroupDetail: vi.fn(),
    refreshGroupDetail: vi.fn(),
    refreshGroupRoles: vi.fn().mockResolvedValue(undefined),
    createGroupRole: vi.fn().mockResolvedValue(undefined),
    renameGroupRole: vi.fn().mockResolvedValue(undefined),
    deleteGroupRole: vi.fn().mockResolvedValue(undefined),
    setGroupRoleMembers: vi.fn().mockResolvedValue(undefined),
    listInviteLinks: vi.fn().mockResolvedValue([]),
    createInviteLink: vi.fn().mockResolvedValue({ url: 'https://zilar.test/join/abc' }),
    revokeInviteLink: vi.fn().mockResolvedValue(undefined),
    createTopic: vi.fn().mockResolvedValue('chat-new'),
    addTopicAi: vi.fn().mockResolvedValue(undefined),
    archiveTopic: vi.fn().mockResolvedValue(undefined),
    setChatPref: vi.fn().mockResolvedValue(undefined),
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
}

const waitFor = async (check: () => void): Promise<void> => {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    try {
      check();
      return;
    } catch {
      await act(async () => {
        await new Promise<void>((resolve) => setTimeout(resolve, 5));
      });
    }
  }
  check();
};

// Lets the pending promises of the last action finish, so the next click is
// not dropped by a busy guard.
const settle = async (): Promise<void> => {
  await act(async () => {
    await new Promise<void>((resolve) => setTimeout(resolve, 10));
  });
};

const text = (): string => container.textContent ?? '';

function buttonNamed(label: string): HTMLButtonElement {
  const found = Array.from(container.querySelectorAll('button')).find(
    (button) => button.getAttribute('aria-label') === label || button.textContent?.trim() === label,
  );
  if (found === undefined) {
    throw new Error(`no button named ${label}`);
  }
  return found;
}

function hasButton(label: string): boolean {
  return Array.from(container.querySelectorAll('button')).some(
    (button) => button.getAttribute('aria-label') === label || button.textContent?.trim() === label,
  );
}

// Async act: the promises a click starts settle inside the act scope.
async function click(button: HTMLButtonElement): Promise<void> {
  await act(async () => {
    button.click();
  });
}

// React reads the value of a controlled input from its own setter, so the
// native setter is used and an input event is dispatched.
async function typeInto(label: string, value: string): Promise<void> {
  const input = container.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`);
  if (input === null) {
    throw new Error(`no field named ${label}`);
  }
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  await act(async () => {
    setter?.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

describe('GroupTopicsScreen (group/[id])', () => {
  it('lists the group topics under the group title', async () => {
    await mount();
    await waitFor(() => expect(text()).toContain('Planning'));
    expect(text()).toContain('Team');
    expect(text()).toContain('General');
    expect(mocks.state.ensureGroupDetail).toHaveBeenCalledWith('g-1');
    expect(mocks.state.refreshGroupRoles).toHaveBeenCalledWith('g-1');
  });

  it('goes back when the group has no topics once the chats are loaded', async () => {
    mocks.state.chats = [];
    await mount();
    await waitFor(() => expect(mocks.router.back).toHaveBeenCalled());
    expect(text()).toBe('');
  });

  it('hides the New topic button from a member when the group does not allow it', async () => {
    mocks.state.detail = MEMBER_DETAIL;
    await mount();
    await waitFor(() => expect(text()).toContain('Planning'));
    expect(hasButton('New topic')).toBe(false);
  });

  it('creates a topic with the chosen AI and opens it', async () => {
    await mount();
    await waitFor(() => expect(hasButton('New topic')).toBe(true));
    await click(buttonNamed('New topic'));
    await click(buttonNamed('Create topic'));
    await waitFor(() =>
      expect(mocks.router.push).toHaveBeenCalledWith({
        pathname: '/chat/[id]',
        params: { id: 'chat-new' },
      }),
    );
    expect(mocks.state.createTopic).toHaveBeenCalledWith('chat-general', {
      name: 'Planning',
      kind: 'topic',
      visibility: 'private',
    });
    expect(mocks.state.addTopicAi).toHaveBeenCalledWith('chat-new', 'ai-9');
  });

  it('names the AI that could not be added and still opens the topic', async () => {
    mocks.state.addTopicAi = vi.fn().mockRejectedValue(new Error('no'));
    await mount();
    await waitFor(() => expect(hasButton('New topic')).toBe(true));
    await click(buttonNamed('New topic'));
    await click(buttonNamed('Create topic'));
    await waitFor(() =>
      expect(text()).toContain(
        'Topic created, but could not add: Dev-9. Add them from the topic panel.',
      ),
    );
    expect(mocks.router.push).toHaveBeenCalledWith({
      pathname: '/chat/[id]',
      params: { id: 'chat-new' },
    });
  });

  it('keeps the new topic sheet open with the fixed error when the create fails', async () => {
    mocks.state.createTopic = vi.fn().mockRejectedValue(new Error('no'));
    await mount();
    await waitFor(() => expect(hasButton('New topic')).toBe(true));
    await click(buttonNamed('New topic'));
    await click(buttonNamed('Create topic'));
    await waitFor(() => expect(text()).toContain('Could not create the topic. Try again.'));
    expect(mocks.router.push).not.toHaveBeenCalled();
  });

  it('archives a topic from its actions sheet', async () => {
    await mount();
    await waitFor(() => expect(text()).toContain('Planning'));
    await click(buttonNamed('More Planning'));
    await click(buttonNamed('Archive topic'));
    await waitFor(() => expect(mocks.state.archiveTopic).toHaveBeenCalledWith('chat-planning'));
    await settle();
    expect(hasButton('Archive topic')).toBe(false);
  });

  it('shows archived topics only after the Archived toggle is pressed', async () => {
    mocks.state.chats = [GENERAL, topic('chat-old', 'Old topic', { archived: true })];
    await mount();
    await waitFor(() => expect(text()).toContain('Archived (1)'));
    expect(text()).not.toContain('Old topic');
    await click(buttonNamed('Archived (1)'));
    await waitFor(() => expect(text()).toContain('Old topic'));
  });

  it('shows the topic notice for this group', async () => {
    mocks.state.topicNotice = { groupId: 'g-1', message: 'You left this topic.' };
    await mount();
    await waitFor(() => expect(text()).toContain('You left this topic.'));
  });

  it('renders the channel feed screen for a channel', async () => {
    mocks.state.chats = [topic('feed-1', 'Feed', { chatKind: 'channel', topic: topicInfo(true) })];
    await mount();
    await waitFor(() => expect(text()).toContain('Channel Team feed feed-1'));
    expect(hasButton('New topic')).toBe(false);
  });

  it('creates an invite link for an owner and shows the URL', async () => {
    await mount();
    await waitFor(() => expect(hasButton('Invite links')).toBe(true));
    await click(buttonNamed('Invite links'));
    await waitFor(() => expect(mocks.state.listInviteLinks).toHaveBeenCalledWith('g-1'));
    await click(buttonNamed('Create link'));
    await waitFor(() => expect(text()).toContain('https://zilar.test/join/abc'));
    expect(mocks.state.createInviteLink).toHaveBeenCalledWith('g-1', { label: 'Team' });
  });

  it('shows the fixed message when the invite link cannot be created', async () => {
    mocks.state.createInviteLink = vi.fn().mockRejectedValue(new Error('raw'));
    await mount();
    await waitFor(() => expect(hasButton('Invite links')).toBe(true));
    await click(buttonNamed('Invite links'));
    await waitFor(() => expect(mocks.state.listInviteLinks).toHaveBeenCalledWith('g-1'));
    await click(buttonNamed('Create link'));
    await waitFor(() => expect(text()).toContain('Could not create the invite link. Try again.'));
    expect(text()).not.toContain('raw');
  });

  it('creates a role from the members and roles sheet', async () => {
    await mount();
    await waitFor(() => expect(hasButton('Members and roles')).toBe(true));
    await click(buttonNamed('Members and roles'));
    await click(buttonNamed('Create role'));
    await waitFor(() => expect(mocks.state.createGroupRole).toHaveBeenCalledWith('g-1', 'Mods'));
  });

  it('makes the group public with a handle and saves it', async () => {
    await mount();
    await waitFor(() => expect(hasButton('Visibility')).toBe(true));
    await click(buttonNamed('Visibility'));
    await waitFor(() => expect(mocks.directoryApi.getGroupVisibility).toHaveBeenCalledWith('g-1'));
    await waitFor(() => expect(text()).toContain('Visibility sheet private'));
    await click(buttonNamed('Make public'));
    await typeInto('Handle', 'dev-team');
    await click(buttonNamed('Save visibility'));
    await waitFor(() =>
      expect(mocks.directoryApi.setGroupVisibility).toHaveBeenCalledWith('g-1', {
        visibility: 'public',
        handle: 'dev-team',
      }),
    );
    expect(mocks.state.refreshGroupDetail).toHaveBeenCalledWith('g-1');
  });

  it('keeps the visibility sheet open with the fixed message when the save fails', async () => {
    mocks.directoryApi.setGroupVisibility.mockRejectedValue(new Error('raw'));
    await mount();
    await waitFor(() => expect(hasButton('Visibility')).toBe(true));
    await click(buttonNamed('Visibility'));
    await waitFor(() => expect(text()).toContain('Visibility sheet private'));
    await click(buttonNamed('Make public'));
    await typeInto('Handle', 'dev-team');
    await click(buttonNamed('Save visibility'));
    await waitFor(() => expect(text()).toContain('Could not save visibility.'));
    expect(text()).not.toContain('raw');
  });
});
