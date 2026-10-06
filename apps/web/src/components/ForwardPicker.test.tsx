import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChatSummary, UiMessage } from '@zilar/chat-core';
import { AuthProvider } from '@/auth/AuthProvider';
import { ChatStoreProvider } from '@/store/ChatStoreProvider';
import { createChatStore, type ChatStoreSeed } from '@/store/store';
import { ForwardPicker } from './ForwardPicker';

beforeEach(cleanup);

const dm: ChatSummary = {
  id: 'c-ana',
  title: 'Ana',
  kind: 'dm',
  isAI: false,
  space: 'personal',
  unread: 0,
  muted: false,
};

const group: ChatSummary = {
  id: 'c-dev',
  title: 'Dev team',
  kind: 'group',
  isAI: false,
  space: 'work',
  unread: 0,
  muted: false,
};

const topic: ChatSummary = {
  id: 'c-design',
  title: 'Design',
  kind: 'group',
  isAI: false,
  space: 'work',
  unread: 0,
  muted: false,
  groupId: 'g-dev',
  groupTitle: 'Dev team',
  topic: {
    id: 't-design',
    glyph: 'chat',
    kind: 'chat',
    status: 'open',
    visibility: 'public',
    isGeneral: false,
    archived: false,
    owner: null,
    linkUrl: null,
    linkLabel: null,
  },
};

const archived: ChatSummary = {
  ...dm,
  id: 'c-old',
  title: 'Old chat',
  archived: true,
};

const memberChannel: ChatSummary = {
  id: 'c-news',
  title: 'News',
  kind: 'group',
  isAI: false,
  space: 'work',
  unread: 0,
  muted: false,
  chatKind: 'channel',
  myRole: 'member',
};

const adminChannel: ChatSummary = {
  ...memberChannel,
  id: 'c-announce',
  title: 'Announcements',
  myRole: 'admin',
};

function message(): UiMessage {
  return {
    id: 'm-1',
    chatId: 'c-ana',
    senderId: 'u-ana',
    senderName: 'Ana',
    text: 'hello there',
    createdAt: new Date('2026-09-28T10:00:00Z'),
    status: 'read',
  };
}

function renderPicker(
  seed: ChatStoreSeed = {
    chats: [dm, group, topic, archived, memberChannel, adminChannel],
  },
  onClose = vi.fn(),
) {
  const store = createChatStore(seed);
  render(
    <AuthProvider
      value={{
        status: 'authenticated',
        user: { id: 'u-you', name: 'You', email: 'you@zilar.test' },
        refetch: async () => {},
      }}
    >
      <ChatStoreProvider store={store}>
        <ForwardPicker messages={[message()]} onClose={onClose} />
      </ChatStoreProvider>
    </AuthProvider>,
  );
  return { store, onClose };
}

describe('ForwardPicker', () => {
  it('lists DMs, groups and topics as Group › Topic', () => {
    renderPicker();

    expect(screen.getByText('Ana')).toBeTruthy();
    expect(screen.getByText('Dev team')).toBeTruthy();
    expect(screen.getByText('Dev team › Design')).toBeTruthy();
  });

  it('hides archived chats and channels where the caller cannot post', () => {
    renderPicker();

    expect(screen.queryByText('Old chat')).toBeNull();
    expect(screen.queryByText('News')).toBeNull();
    expect(screen.getByText('Announcements')).toBeTruthy();
  });

  it('filters by title and by group title for topics', () => {
    renderPicker();

    fireEvent.change(screen.getByRole('searchbox', { name: 'Search chats' }), {
      target: { value: 'ana' },
    });
    expect(screen.getByText('Ana')).toBeTruthy();
    expect(screen.queryByText('Dev team › Design')).toBeNull();

    fireEvent.change(screen.getByRole('searchbox', { name: 'Search chats' }), {
      target: { value: 'dev' },
    });
    expect(screen.getByText('Dev team')).toBeTruthy();
    expect(screen.getByText('Dev team › Design')).toBeTruthy();
    expect(screen.queryByText('Ana')).toBeNull();
  });

  it('keeps Send disabled until a chat is chosen', () => {
    renderPicker();

    const send = screen.getByRole('button', { name: 'Send' }) as HTMLButtonElement;
    expect(send.disabled).toBe(true);

    fireEvent.click(screen.getByText('Ana'));
    expect((screen.getByRole('button', { name: 'Send' }) as HTMLButtonElement).disabled).toBe(
      false,
    );
  });

  it('sends the chosen ids and the comment, then closes', () => {
    const onClose = vi.fn();
    const { store } = renderPicker(undefined, onClose);
    const forwardMessages = vi.fn();
    store.setState({ forwardMessages });

    fireEvent.click(screen.getByText('Ana'));
    fireEvent.click(screen.getByText('Dev team'));
    fireEvent.change(screen.getByLabelText('Add a comment (optional)'), {
      target: { value: '  check this out  ' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Send to 2 chats' }));

    expect(forwardMessages).toHaveBeenCalledWith(['c-ana', 'c-dev'], [message()], {
      comment: 'check this out',
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('sends without a comment when the field is blank', () => {
    const { store } = renderPicker();
    const forwardMessages = vi.fn();
    store.setState({ forwardMessages });

    fireEvent.click(screen.getByText('Ana'));
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));

    expect(forwardMessages).toHaveBeenCalledWith(['c-ana'], [message()], undefined);
  });

  it('closes without sending when Cancel is clicked', () => {
    const onClose = vi.fn();
    const { store } = renderPicker(undefined, onClose);
    const forwardMessages = vi.fn();
    store.setState({ forwardMessages });

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(forwardMessages).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
