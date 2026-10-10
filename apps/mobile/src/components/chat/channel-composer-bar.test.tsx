// @vitest-environment jsdom
import { createRequire } from 'node:module';
import { act, createElement, type ReactNode } from 'react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ChatSummary } from '@/lib/types';
import { ChannelComposerBar } from './channel-composer-bar';
import { waitForAct as waitFor } from '@/test/wait';

// The mobile app has no React Native testing library: the primitives are
// mocked with small DOM components and the composer with a marker (the
// `use-action.test.tsx` jsdom pattern).
const nodeRequire = createRequire(import.meta.url);
const { createRoot } = nodeRequire('react-dom/client') as {
  createRoot: (container: Element) => { render(node: ReactNode): void; unmount(): void };
};

type Kids = { children?: ReactNode };

const mocks = vi.hoisted(() => ({
  setChatPref: vi.fn(),
  detail: undefined as undefined | { members: { userId: string; role: string }[] },
}));

vi.mock('react-native', () => ({
  Pressable: ({
    onPress,
    accessibilityLabel,
    disabled,
    children,
  }: Kids & { onPress?: () => void; accessibilityLabel?: string; disabled?: boolean }) =>
    createElement(
      'button',
      { type: 'button', 'aria-label': accessibilityLabel, disabled, onClick: onPress },
      children,
    ),
  View: ({ children }: Kids) => createElement('div', null, children),
}));

vi.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

vi.mock('@/components/ui/text', () => ({
  Text: ({ children, role }: Kids & { role?: string }) => createElement('span', { role }, children),
}));

vi.mock('@/store/chat-store-provider', () => ({
  useChatStore: (select: (state: unknown) => unknown) =>
    select({
      currentUserId: 'me',
      groupDetail: () => mocks.detail,
      setChatPref: mocks.setChatPref,
    }),
}));

vi.mock('./composer', () => ({
  Composer: ({ title }: { title?: string }) => createElement('div', { 'data-composer': title }),
}));

const mounted: Array<() => void> = [];

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

beforeEach(() => {
  mocks.setChatPref.mockReset();
  mocks.detail = undefined;
});

afterEach(async () => {
  await act(async () => {
    await new Promise<void>((resolve) => setTimeout(resolve, 10));
  });
  while (mounted.length > 0) {
    mounted.pop()?.();
  }
});

function chat(overrides: Partial<ChatSummary> = {}): ChatSummary {
  return {
    id: 'c1',
    title: 'News',
    chatKind: 'channel',
    ...overrides,
  } as ChatSummary;
}

function render(row: ChatSummary) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(
      createElement(ChannelComposerBar, {
        chat: row,
        groupId: 'g1',
        onCancelReply: () => {},
        onSend: () => {},
        onSendSticker: () => {},
      }),
    );
  });
  mounted.push(() => {
    act(() => root.unmount());
    container.remove();
  });
  return container;
}

function button(container: Element, label: string): HTMLButtonElement {
  const element = container.querySelector<HTMLButtonElement>(`[aria-label="${label}"]`);
  if (element === null) {
    throw new Error(`No button labelled ${label}`);
  }
  return element;
}

describe('ChannelComposerBar', () => {
  it('shows the composer to owners and admins', () => {
    const container = render(chat({ myRole: 'admin' }));
    expect(container.querySelector('[data-composer]')).not.toBeNull();
    expect(container.textContent).not.toContain('Only admins can post here');
  });

  it('shows the composer for a chat that is not a channel', () => {
    const container = render(chat({ chatKind: 'group', myRole: 'member' }));
    expect(container.querySelector('[data-composer]')).not.toBeNull();
  });

  it('backs the role up with the group detail', () => {
    mocks.detail = { members: [{ userId: 'me', role: 'owner' }] };
    const container = render(chat());
    expect(container.querySelector('[data-composer]')).not.toBeNull();
  });

  it('shows the read-only bar to a subscriber and to an unknown role', () => {
    const subscriber = render(chat({ myRole: 'member' }));
    expect(subscriber.textContent).toContain('Only admins can post here');
    expect(subscriber.querySelector('[data-composer]')).toBeNull();
    const unknown = render(chat());
    expect(unknown.textContent).toContain('Only admins can post here');
  });

  it('mutes forever with one tap and is busy until the store answers', async () => {
    let finish: () => void = () => {};
    mocks.setChatPref.mockReturnValue(
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
    );
    const container = render(chat({ myRole: 'member', muted: false }));
    act(() => button(container, 'Mute').click());
    expect(mocks.setChatPref).toHaveBeenCalledTimes(1);
    const [chatId, pref] = mocks.setChatPref.mock.calls[0] as [string, { mutedUntil: string }];
    expect(chatId).toBe('c1');
    expect(typeof pref.mutedUntil).toBe('string');
    await waitFor(() => expect(button(container, 'Mute').disabled).toBe(true));
    // A second tap while busy is ignored.
    act(() => button(container, 'Mute').click());
    expect(mocks.setChatPref).toHaveBeenCalledTimes(1);
    await act(async () => finish());
    await waitFor(() => expect(button(container, 'Mute').disabled).toBe(false));
    expect(container.querySelector('[role="alert"]')).toBeNull();
  });

  it('clears the mute with null when the channel is muted', async () => {
    mocks.setChatPref.mockResolvedValue(undefined);
    const container = render(chat({ myRole: 'member', muted: true }));
    act(() => button(container, 'Unmute').click());
    await waitFor(() => expect(mocks.setChatPref).toHaveBeenCalledWith('c1', { mutedUntil: null }));
  });

  it('shows a fixed sentence when the change fails and clears it on the next try', async () => {
    mocks.setChatPref.mockRejectedValueOnce(new Error('server said 500'));
    const container = render(chat({ myRole: 'member', muted: false }));
    act(() => button(container, 'Mute').click());
    await waitFor(() => {
      expect(container.querySelector('[role="alert"]')?.textContent).toBe(
        'Could not change the mute. Try again.',
      );
    });
    expect(container.textContent).not.toContain('server said 500');
    expect(button(container, 'Mute').disabled).toBe(false);
    mocks.setChatPref.mockResolvedValueOnce(undefined);
    act(() => button(container, 'Mute').click());
    await waitFor(() => expect(mocks.setChatPref).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(container.querySelector('[role="alert"]')).toBeNull());
  });
});
