import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import type { ChatSummary } from '@galena/chat-core';
import { renderApp } from '@/test/renderApp';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('NewChatButton', () => {
  it('creates a group from the dialog and opens it', async () => {
    const room: ChatSummary = {
      id: 'new@rooms.galena.test',
      title: 'Crew',
      kind: 'group',
      isAI: false,
      space: 'personal',
      unread: 0,
      muted: false,
      memberCount: 1,
    };
    const { store } = renderApp('/', {
      chats: [],
      contacts: [{ userId: 'u-ana', name: 'Ana', jid: 'ana@galena.test' }],
    });
    const createGroup = vi.fn(async (_title: string, _memberIds: string[]) => {
      store.setState((state) => ({ chats: [...state.chats, room] }));
      return room.id;
    });
    store.setState({ createGroup });

    fireEvent.click(screen.getByLabelText('New chat'));
    fireEvent.click(screen.getByRole('menuitem', { name: 'New group' }));
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    fireEvent.change(screen.getByLabelText('Group name'), { target: { value: 'Crew' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create' }));

    await waitFor(() => expect(createGroup).toHaveBeenCalledWith('Crew', ['u-ana']));
    expect(await screen.findByText('Crew')).toBeTruthy();
  });

  it('shows the invite link and copies it', async () => {
    const { store } = renderApp('/');
    const createInvite = vi.fn(async () => 'http://localhost:3000/invite/abc');
    store.setState({ createInvite });

    fireEvent.click(screen.getByLabelText('New chat'));
    fireEvent.click(screen.getByRole('menuitem', { name: 'New message' }));
    fireEvent.click(screen.getByRole('button', { name: 'Invite a friend' }));

    await waitFor(() => expect(screen.getByText('http://localhost:3000/invite/abc')).toBeTruthy());

    fireEvent.click(screen.getByLabelText('Copy invite link'));
    await waitFor(() => expect(screen.getByText('Copied')).toBeTruthy());
  });

  it('has a New AI entry that opens the quick-create dialog', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => [],
      } as Response),
    );
    renderApp('/');

    fireEvent.click(screen.getByLabelText('New chat'));
    fireEvent.click(screen.getByRole('menuitem', { name: 'New AI' }));

    expect(await screen.findByRole('dialog', { name: 'New AI' })).toBeTruthy();
  });
});

describe('NewChatButton Escape handling (T-0062)', () => {
  it('closes the menu and returns focus to the trigger when focus is on the trigger', () => {
    renderApp('/');

    const trigger = screen.getByLabelText('New chat');
    fireEvent.click(trigger);
    expect(screen.getByRole('menu', { name: 'New chat actions' })).toBeTruthy();
    expect(trigger.getAttribute('aria-expanded')).toBe('true');

    fireEvent.keyDown(document, { key: 'Escape' });

    expect(screen.queryByRole('menu', { name: 'New chat actions' })).toBeNull();
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    expect(document.activeElement).toBe(trigger);
  });

  it('closes the menu and returns focus to the trigger when focus is inside the menu', () => {
    renderApp('/');

    const trigger = screen.getByLabelText('New chat');
    fireEvent.click(trigger);
    const item = screen.getByRole('menuitem', { name: 'New group' });
    item.focus();

    fireEvent.keyDown(document, { key: 'Escape' });

    expect(screen.queryByRole('menu', { name: 'New chat actions' })).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it('closes the New message dialog with Escape and returns focus to the trigger', () => {
    renderApp('/');

    const trigger = screen.getByLabelText('New chat');
    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole('menuitem', { name: 'New message' }));
    expect(screen.getByRole('dialog', { name: 'New message' })).toBeTruthy();

    fireEvent.keyDown(document, { key: 'Escape' });

    expect(screen.queryByRole('dialog', { name: 'New message' })).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it('closes the New group dialog with Escape and returns focus to the trigger', () => {
    renderApp('/', {
      contacts: [{ userId: 'u-ana', name: 'Ana', jid: 'ana@galena.test' }],
    });

    const trigger = screen.getByLabelText('New chat');
    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole('menuitem', { name: 'New group' }));
    expect(screen.getByRole('dialog', { name: 'New group' })).toBeTruthy();

    fireEvent.keyDown(document, { key: 'Escape' });

    expect(screen.queryByRole('dialog', { name: 'New group' })).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it('closes the New AI dialog with Escape and returns focus to the trigger', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => [] } as Response),
    );
    renderApp('/');

    const trigger = screen.getByLabelText('New chat');
    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole('menuitem', { name: 'New AI' }));
    expect(await screen.findByRole('dialog', { name: 'New AI' })).toBeTruthy();

    fireEvent.keyDown(document, { key: 'Escape' });

    expect(screen.queryByRole('dialog', { name: 'New AI' })).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it('closes the Invite dialog with Escape and returns focus to the trigger', async () => {
    renderApp('/');

    const trigger = screen.getByLabelText('New chat');
    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole('menuitem', { name: 'New message' }));
    // "Invite a friend" replaces the New message dialog with the Invite dialog.
    fireEvent.click(screen.getByRole('button', { name: 'Invite a friend' }));
    expect(await screen.findByRole('dialog', { name: 'Invite a friend' })).toBeTruthy();

    fireEvent.keyDown(document, { key: 'Escape' });

    expect(screen.queryByRole('dialog', { name: 'Invite a friend' })).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });
});
