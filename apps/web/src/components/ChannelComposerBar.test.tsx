import { describe, expect, it, vi, type Mock } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ChatSummary } from '@zilar/chat-core';
import { AuthProvider, type AuthState } from '@/auth/AuthProvider';
import { ChatStoreProvider } from '@/store/ChatStoreProvider';
import { createChatStore, type ChatStoreSeed } from '@/store/store';
import { ChannelComposerBar } from './ChannelComposerBar';

type SetMuted = Mock<(chatId: string, duration: unknown) => Promise<void>>;

const auth: AuthState = {
  status: 'authenticated',
  user: { id: 'u-you', name: 'You', email: 'you@zilar.test' },
  refetch: async () => {},
};

const channel: ChatSummary = {
  id: 'c-chan',
  title: 'Team news',
  kind: 'group',
  isAI: false,
  space: 'work',
  unread: 0,
  muted: false,
  memberCount: 3,
  subscriberCount: 3,
};

const READ_ONLY_TEXT = 'Only admins can post here';

function renderBar(
  options: {
    chat?: Partial<ChatSummary>;
    seed?: ChatStoreSeed;
    setMuted?: SetMuted;
  } = {},
) {
  const store = createChatStore({ currentUserId: 'u-you', ...options.seed });
  if (options.setMuted !== undefined) {
    store.setState({ setMuted: options.setMuted });
  }
  const chat = { ...channel, ...options.chat };
  return render(
    <AuthProvider value={auth}>
      <ChatStoreProvider store={store}>
        <ChannelComposerBar chat={chat} />
      </ChatStoreProvider>
    </AuthProvider>,
  );
}

describe('ChannelComposerBar', () => {
  it('shows the normal composer to an owner, without the read-only bar', () => {
    renderBar({ chat: { myRole: 'owner' } });

    expect(screen.queryByText(READ_ONLY_TEXT)).toBeNull();
    expect(screen.queryByRole('button', { name: 'Mute' })).toBeNull();
  });

  it('shows the normal composer to an admin', () => {
    renderBar({ chat: { myRole: 'admin' } });

    expect(screen.queryByText(READ_ONLY_TEXT)).toBeNull();
  });

  it('shows the read-only bar with Mute to a subscriber', () => {
    renderBar({ chat: { myRole: 'member' } });

    expect(screen.getByText(READ_ONLY_TEXT)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Mute' })).toBeTruthy();
  });

  it('reads the role from the group info when the chat row has none', () => {
    renderBar({
      seed: {
        groupInfos: {
          'c-chan': {
            id: 'g-chan',
            title: 'Team news',
            createdBy: 'u-you',
            members: [{ userId: 'u-you', name: 'You', role: 'admin' }],
            ais: [],
          },
        },
      },
    });

    expect(screen.queryByText(READ_ONLY_TEXT)).toBeNull();
  });

  it('treats a subscriber with no known role as read-only', () => {
    renderBar();

    expect(screen.getByText(READ_ONLY_TEXT)).toBeTruthy();
  });

  it('mutes an unmuted channel forever', async () => {
    const setMuted = vi.fn<(chatId: string, duration: unknown) => Promise<void>>(async () => {});
    renderBar({ chat: { myRole: 'member', muted: false }, setMuted });

    fireEvent.click(screen.getByRole('button', { name: 'Mute' }));

    await waitFor(() => expect(setMuted).toHaveBeenCalledWith('c-chan', 'forever'));
  });

  it('clears the mute of a muted channel', async () => {
    const setMuted = vi.fn<(chatId: string, duration: unknown) => Promise<void>>(async () => {});
    renderBar({ chat: { myRole: 'member', muted: true }, setMuted });

    fireEvent.click(screen.getByRole('button', { name: 'Unmute' }));

    await waitFor(() => expect(setMuted).toHaveBeenCalledWith('c-chan', null));
  });

  it('sends a double click once and disables the button while it waits', async () => {
    let finish!: () => void;
    const setMuted = vi.fn<(chatId: string, duration: unknown) => Promise<void>>(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    renderBar({ chat: { myRole: 'member' }, setMuted });

    const button = screen.getByRole('button', { name: 'Mute' });
    fireEvent.click(button);
    fireEvent.click(button);

    expect(setMuted).toHaveBeenCalledTimes(1);
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Mute' }).hasAttribute('disabled')).toBe(true),
    );
    finish();
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Mute' }).hasAttribute('disabled')).toBe(false),
    );
  });

  it('shows the fixed sentence when the mute fails, and the button works again', async () => {
    const setMuted = vi
      .fn<(chatId: string, duration: unknown) => Promise<void>>()
      .mockRejectedValueOnce(new Error('network down'))
      .mockResolvedValueOnce(undefined);
    renderBar({ chat: { myRole: 'member' }, setMuted });

    fireEvent.click(screen.getByRole('button', { name: 'Mute' }));

    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.getByRole('alert').textContent).toBe('Could not change the mute. Try again.');
    expect(screen.getByRole('button', { name: 'Mute' }).hasAttribute('disabled')).toBe(false);

    fireEvent.click(screen.getByRole('button', { name: 'Mute' }));
    await waitFor(() => expect(setMuted).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
  });
});
