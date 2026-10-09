// @vitest-environment jsdom
import { createRequire } from 'node:module';
import { act, createElement, type ReactNode } from 'react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { ChannelScreen } from './channel-screen';

// Mounted with react-dom/client under jsdom (the use-action.test pattern): the
// screen's effects and clicks run for real, and only the native edges and the
// store are stubbed.
const nodeRequire = createRequire(import.meta.url);
const { createRoot } = nodeRequire('react-dom/client') as {
  createRoot: (container: Element) => { render(node: ReactNode): void; unmount(): void };
};

const hoisted = vi.hoisted(() => ({
  router: { replace: vi.fn(), push: vi.fn() },
  store: {} as Record<string, unknown>,
}));

vi.mock('expo-router', () => ({
  useRouter: () => hoisted.router,
}));

vi.mock('expo-clipboard', () => ({
  setStringAsync: vi.fn(async () => true),
}));

vi.mock('lucide-react-native', () => ({
  Megaphone: () => null,
}));

vi.mock('react-native', async () => {
  const React = await import('react');
  type HostProps = {
    children?: React.ReactNode;
    accessibilityLabel?: string;
    onPress?: () => void;
    disabled?: boolean;
  };
  const host =
    (tag: string) =>
    ({ children, accessibilityLabel, onPress, disabled }: HostProps) =>
      React.createElement(
        tag,
        { 'aria-label': accessibilityLabel, onClick: onPress, disabled },
        children,
      );
  return {
    Pressable: host('button'),
    Share: { share: vi.fn(async () => ({})) },
    View: host('div'),
  };
});

vi.mock('react-native-safe-area-context', async () => {
  const React = await import('react');
  return {
    SafeAreaView: ({ children }: { children?: React.ReactNode }) =>
      React.createElement('div', null, children),
  };
});

vi.mock('@/auth/RequireAuth', () => ({
  RequireAuth: ({ children }: { children: ReactNode }) => children,
}));

vi.mock('@/components/chat/avatar', () => ({
  Avatar: () => null,
}));

vi.mock('@/components/ui/text', async () => {
  const React = await import('react');
  return {
    Text: ({ children, role }: { children?: React.ReactNode; role?: string }) =>
      React.createElement('span', { role }, children),
  };
});

vi.mock('@/components/ui/button', async () => {
  const React = await import('react');
  return {
    Button: ({
      children,
      accessibilityLabel,
      disabled,
      onPress,
    }: {
      children?: React.ReactNode;
      accessibilityLabel?: string;
      disabled?: boolean;
      onPress?: () => void;
    }) =>
      React.createElement(
        'button',
        { 'aria-label': accessibilityLabel, disabled, onClick: onPress },
        children,
      ),
  };
});

// The links sheet has its own tests; this stub shows the props the screen
// feeds it (the error line, the link count) and fires its callbacks.
vi.mock('@/components/chat/invite-links-sheet', async () => {
  const React = await import('react');
  type SheetProps = {
    visible: boolean;
    error: string;
    links: { id: string }[];
    onCreate: (input: { label: string }) => void;
    onRevoke: (linkId: string) => void;
    onClose: () => void;
  };
  return {
    InviteLinksSheet: (props: SheetProps) =>
      props.visible
        ? React.createElement(
            'section',
            { 'aria-label': 'Invite links sheet' },
            React.createElement('p', null, props.error),
            React.createElement('p', null, `links ${props.links.length}`),
            React.createElement('button', {
              'aria-label': 'Create link',
              onClick: () => props.onCreate({ label: 'Team' }),
            }),
            React.createElement('button', {
              'aria-label': 'Revoke first link',
              onClick: () => props.onRevoke(props.links[0]?.id ?? ''),
            }),
            React.createElement('button', { 'aria-label': 'Close links', onClick: props.onClose }),
          )
        : null,
  };
});

vi.mock('@/store/chat-store-provider', () => ({
  useChatStore: (selector: (state: unknown) => unknown) => selector(hoisted.store),
}));

const GROUP = 'group-1';
const FEED = 'feed-1';

type Member = { userId: string; name: string; role: 'owner' | 'admin' | 'member' };
const OWNER: Member = { userId: 'me', name: 'You', role: 'owner' };
const ADA: Member = { userId: 'a1', name: 'Ada', role: 'admin' };
const SAM: Member = { userId: 's1', name: 'Sam', role: 'member' };

// Each test sets the store the screen reads. An owner sees the full member
// list in the group detail; a subscriber's detail carries no members (the
// server strips them), so the admins come from `listChannelMembers`.
function arrange(role: 'owner' | 'member', overrides: Record<string, unknown> = {}) {
  const members = role === 'owner' ? [OWNER, ADA, SAM] : [];
  // One stable detail object, as the store keeps it: a new object per read
  // would re-run the admins load on every render.
  const detail = { members, description: null };
  hoisted.store = {
    groupDetail: () => detail,
    ensureGroupDetail: vi.fn(),
    currentUserId: 'me',
    chats: [{ id: FEED, myRole: role, subscriberCount: 3 }],
    listChannelMembers: vi.fn(async () => [OWNER, ADA]),
    changeChannelRole: vi.fn(async () => {}),
    leaveChannel: vi.fn(async () => {}),
    listInviteLinks: vi.fn(async () => []),
    createInviteLink: vi.fn(async () => ({ url: 'https://zilar.test/join/abc' })),
    revokeInviteLink: vi.fn(async () => {}),
    ...overrides,
  };
}

const mounted: Array<() => void> = [];

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  while (mounted.length > 0) {
    mounted.pop()?.();
  }
});

let unmountLatest: () => void = () => {};

function mountScreen(): HTMLElement {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(createElement(ChannelScreen, { groupId: GROUP, feedId: FEED, title: 'News' }));
  });
  let live = true;
  const unmount = () => {
    if (!live) {
      return;
    }
    live = false;
    act(() => root.unmount());
    container.remove();
  };
  mounted.push(unmount);
  unmountLatest = unmount;
  return container;
}

/** Unmounts the screen now, as navigating away does; afterEach then skips it. */
function unmountScreen(): void {
  unmountLatest();
}

// Lets the pending store promises settle and their state updates land.
const settle = () =>
  act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

async function click(container: HTMLElement, label: string): Promise<void> {
  const control = container.querySelector<HTMLElement>(`[aria-label="${label}"]`);
  if (control === null) {
    throw new Error(`no control labelled ${label}`);
  }
  await act(async () => {
    control.click();
  });
  await settle();
}

describe('channel screen: subscriber view', () => {
  it('loads the admins for a subscriber and never shows the audience', async () => {
    const listChannelMembers = vi.fn(async () => [OWNER, ADA]);
    arrange('member', { listChannelMembers });
    const screen = mountScreen();
    await settle();
    expect(listChannelMembers).toHaveBeenCalledWith(GROUP);
    expect(screen.textContent).toContain('ADMINS');
    expect(screen.textContent).not.toContain('SUBSCRIBERS');
    expect(screen.textContent).toContain('Ada');
    expect(screen.textContent).toContain('3 subscribers');
    expect(screen.querySelector('[aria-label="Leave channel"]')).not.toBeNull();
    expect(screen.querySelector('[aria-label="Invite links"]')).toBeNull();
  });

  it('shows a retry line when the admins cannot load', async () => {
    arrange('member', {
      listChannelMembers: vi.fn(async () => {
        throw new Error('down');
      }),
    });
    const screen = mountScreen();
    await settle();
    expect(screen.textContent).toContain('Could not load the admins. Try again.');
  });

  it('leaving routes to the home screen', async () => {
    const leaveChannel = vi.fn(async () => {});
    arrange('member', { leaveChannel });
    const screen = mountScreen();
    await settle();
    await click(screen, 'Leave channel');
    expect(leaveChannel).toHaveBeenCalledWith(FEED);
    expect(hoisted.router.replace).toHaveBeenCalledWith('/');
  });

  it('a leave still finishes and navigates after the screen unmounts', async () => {
    // Leaving navigates away, so the screen is often gone before the store
    // call resolves: the follow-up (the navigation) must still happen.
    let finishLeave: () => void = () => {};
    const leaveChannel = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finishLeave = resolve;
        }),
    );
    arrange('member', { leaveChannel });
    const screen = mountScreen();
    await settle();
    await click(screen, 'Leave channel');
    expect(leaveChannel).toHaveBeenCalledWith(FEED);
    unmountScreen();
    // Give the unmount time to drop the action's subscriber (the registry
    // disposes it on a later tick) before the store call resolves.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 100));
    });
    await act(async () => {
      finishLeave();
    });
    await settle();
    expect(hoisted.router.replace).toHaveBeenCalledWith('/');
  });

  it('a failed leave shows its line and the button comes back', async () => {
    arrange('member', {
      leaveChannel: vi.fn(async () => {
        throw new Error('nope');
      }),
    });
    const screen = mountScreen();
    await settle();
    await click(screen, 'Leave channel');
    expect(screen.textContent).toContain('Could not leave the channel. Try again.');
    expect(hoisted.router.replace).not.toHaveBeenCalled();
    const button = screen.querySelector<HTMLButtonElement>('[aria-label="Leave channel"]');
    expect(button?.disabled).toBe(false);
  });

  it('the feed row opens the feed', async () => {
    arrange('member');
    const screen = mountScreen();
    await settle();
    await click(screen, 'Open the News feed');
    expect(hoisted.router.push).toHaveBeenCalledWith({
      pathname: '/chat/[id]',
      params: { id: FEED },
    });
  });
});

describe('channel screen: owner view', () => {
  it('shows the subscribers and invite links, and promotes a subscriber', async () => {
    const changeChannelRole = vi.fn(async () => {});
    arrange('owner', { changeChannelRole });
    const screen = mountScreen();
    await settle();
    expect(screen.textContent).toContain('SUBSCRIBERS');
    expect(screen.querySelector('[aria-label="Leave channel"]')).toBeNull();
    await click(screen, 'Promote Sam to admin');
    expect(changeChannelRole).toHaveBeenCalledWith(FEED, 's1', 'admin');
  });

  it('a demotion blocked by the last-admin guard shows the plain line', async () => {
    const changeChannelRole = vi.fn(async () => {
      throw Object.assign(new Error('guard'), { code: 'channel_needs_admin' });
    });
    arrange('owner', { changeChannelRole });
    const screen = mountScreen();
    await settle();
    await click(screen, 'Demote Ada to subscriber');
    expect(changeChannelRole).toHaveBeenCalledWith(FEED, 'a1', 'member');
    expect(screen.textContent).toContain('The channel needs at least one admin.');
  });

  it('any other role failure shows the generic line', async () => {
    arrange('owner', {
      changeChannelRole: vi.fn(async () => {
        throw new Error('server');
      }),
    });
    const screen = mountScreen();
    await settle();
    await click(screen, 'Promote Sam to admin');
    expect(screen.textContent).toContain('Could not change the role. Try again.');
    expect(screen.textContent).not.toContain('needs at least one admin');
  });

  it('opening invite links loads them', async () => {
    const listInviteLinks = vi.fn(async () => []);
    arrange('owner', { listInviteLinks });
    const screen = mountScreen();
    await settle();
    await click(screen, 'Invite links');
    expect(listInviteLinks).toHaveBeenCalledWith(GROUP);
    expect(screen.querySelector('[aria-label="Invite links sheet"]')).not.toBeNull();
  });

  it('a failed links load shows its line', async () => {
    arrange('owner', {
      listInviteLinks: vi.fn(async () => {
        throw new Error('down');
      }),
    });
    const screen = mountScreen();
    await settle();
    await click(screen, 'Invite links');
    expect(screen.textContent).toContain('Could not load invite links. Try again.');
  });

  it('creating a link calls the store, then reloads the list', async () => {
    const createInviteLink = vi.fn(async () => ({ url: 'https://zilar.test/join/abc' }));
    const listInviteLinks = vi.fn(async () => []);
    arrange('owner', { createInviteLink, listInviteLinks });
    const screen = mountScreen();
    await settle();
    await click(screen, 'Invite links');
    await click(screen, 'Create link');
    expect(createInviteLink).toHaveBeenCalledWith(GROUP, { label: 'Team' });
    expect(listInviteLinks).toHaveBeenCalledTimes(2);
  });

  it('a failed create shows its line', async () => {
    arrange('owner', {
      createInviteLink: vi.fn(async () => {
        throw new Error('server');
      }),
    });
    const screen = mountScreen();
    await settle();
    await click(screen, 'Invite links');
    await click(screen, 'Create link');
    expect(screen.textContent).toContain('Could not create the invite link. Try again.');
  });

  it('revoking a link calls the store with its id, then reloads the list', async () => {
    const revokeInviteLink = vi.fn(async () => {});
    const listInviteLinks = vi.fn(async () => [
      {
        id: 'link-1',
        label: null,
        tokenHint: 'abc',
        uses: 0,
        maxUses: null,
        expiresAt: null,
        revoked: false,
        createdAt: '2026-10-09T00:00:00.000Z',
      },
    ]);
    arrange('owner', { revokeInviteLink, listInviteLinks });
    const screen = mountScreen();
    await settle();
    await click(screen, 'Invite links');
    await click(screen, 'Revoke first link');
    expect(revokeInviteLink).toHaveBeenCalledWith(GROUP, 'link-1');
    expect(listInviteLinks).toHaveBeenCalledTimes(2);
  });

  it('a failed revoke shows its line', async () => {
    arrange('owner', {
      revokeInviteLink: vi.fn(async () => {
        throw new Error('server');
      }),
    });
    const screen = mountScreen();
    await settle();
    await click(screen, 'Invite links');
    await click(screen, 'Revoke first link');
    expect(screen.textContent).toContain('Could not revoke the invite link. Try again.');
  });
});
