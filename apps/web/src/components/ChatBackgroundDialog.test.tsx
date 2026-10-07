import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import type { ChatSummary } from '@zilar/chat-core';
import { AuthProvider } from '@/auth/AuthProvider';
import { ChatStoreProvider } from '@/store/ChatStoreProvider';
import { createChatStore, type ChatStoreState } from '@/store/store';
import { ChatBackgroundDialog } from './ChatBackgroundDialog';

const auth = {
  status: 'authenticated' as const,
  user: { id: 'u-you', name: 'You', email: 'you@zilar.test' },
  refetch: async () => {},
};

const chat: ChatSummary = {
  id: 'c-ana',
  title: 'Ana',
  kind: 'dm',
  isAI: false,
  space: 'personal',
  unread: 0,
  muted: false,
};

function renderDialog(overrides: Partial<ChatStoreState> = {}) {
  const store = createChatStore({ chats: [chat] });
  store.setState(overrides);
  const onClose = vi.fn();
  render(
    <AuthProvider value={auth}>
      <ChatStoreProvider store={store}>
        <ChatBackgroundDialog chat={chat} open onClose={onClose} />
      </ChatStoreProvider>
    </AuthProvider>,
  );
  return { store, onClose };
}

function renderReopenable(overrides: Partial<ChatStoreState> = {}) {
  const store = createChatStore({ chats: [chat] });
  store.setState(overrides);
  function Harness() {
    const [open, setOpen] = useState(true);
    return (
      <>
        <button type="button" onClick={() => setOpen(true)}>
          Open background
        </button>
        <ChatBackgroundDialog chat={chat} open={open} onClose={() => setOpen(false)} />
      </>
    );
  }
  render(
    <AuthProvider value={auth}>
      <ChatStoreProvider store={store}>
        <Harness />
      </ChatStoreProvider>
    </AuthProvider>,
  );
  return { store };
}

afterEach(() => {
  cleanup();
});

describe('ChatBackgroundDialog (T-0462)', () => {
  it('picks a preset for this chat', async () => {
    const setChatBackground = vi.fn(async () => {});
    renderDialog({ setChatBackground });

    fireEvent.click(screen.getByRole('button', { name: 'Navy' }));

    await waitFor(() => expect(setChatBackground).toHaveBeenCalledWith('c-ana', 'navy'));
  });

  it('picks a preset for all chats', async () => {
    const setDefaultBackground = vi.fn(async () => {});
    renderDialog({ setDefaultBackground });

    fireEvent.click(screen.getByRole('radio', { name: 'All chats' }));
    fireEvent.click(screen.getByRole('button', { name: 'Gold' }));

    await waitFor(() => expect(setDefaultBackground).toHaveBeenCalledWith('gold'));
  });

  it('clears the choice with "Use default"', async () => {
    const setChatBackground = vi.fn(async () => {});
    renderDialog({ setChatBackground });

    fireEvent.click(screen.getByRole('button', { name: 'Use default' }));

    await waitFor(() => expect(setChatBackground).toHaveBeenCalledWith('c-ana', null));
  });

  it('marks the chat preset as selected', () => {
    renderDialog({
      chatPrefs: {
        'c-ana': {
          chatJid: 'c-ana',
          mutedUntil: null,
          archived: false,
          pinnedAt: null,
          updatedAt: '2026-10-07T00:00:00.000Z',
          backgroundPreset: 'navy',
          backgroundImageId: null,
          backgroundDim: null,
        },
      },
    });

    expect(screen.getByRole('button', { name: 'Navy' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('button', { name: 'Gold' }).getAttribute('aria-pressed')).toBe('false');
  });

  it('shows an inline alert when the save is rejected', async () => {
    const setChatBackground = vi.fn(async () => {
      throw new Error('offline');
    });
    renderDialog({ setChatBackground });

    fireEvent.click(screen.getByRole('button', { name: 'Blue' }));

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('save the background');
  });

  it('clears the global default from "All chats"', async () => {
    const setDefaultBackground = vi.fn(async () => {});
    renderDialog({ setDefaultBackground });

    fireEvent.click(screen.getByRole('radio', { name: 'All chats' }));
    fireEvent.click(screen.getByRole('button', { name: 'Use default' }));

    await waitFor(() => expect(setDefaultBackground).toHaveBeenCalledWith(null));
  });

  it('clears the alert and resets the scope when reopened', async () => {
    const setChatBackground = vi.fn(async () => {
      throw new Error('offline');
    });
    renderReopenable({ setChatBackground });

    fireEvent.click(screen.getByRole('radio', { name: 'All chats' }));
    fireEvent.click(screen.getByRole('button', { name: 'Blue' }));
    expect(await screen.findByRole('alert')).toBeTruthy();

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Open background' }));

    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByRole('radio', { name: 'This chat' }).getAttribute('aria-checked')).toBe(
      'true',
    );
  });
});
