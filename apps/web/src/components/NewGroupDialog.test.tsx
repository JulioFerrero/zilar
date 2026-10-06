import { describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import type { ChatSummary } from '@zilar/chat-core';
import { renderApp } from '@/test/renderApp';

const room: ChatSummary = {
  id: 'new@rooms.zilar.test',
  title: 'Hiking club',
  kind: 'group',
  isAI: false,
  space: 'personal',
  unread: 0,
  muted: false,
  memberCount: 1,
};

function openCreateDialog() {
  const { store } = renderApp('/', {
    chats: [],
    contacts: [{ userId: 'u-ana', name: 'Ana', jid: 'ana@zilar.test' }],
  });
  const createGroup = vi.fn(async (_title: string, _memberIds: string[], _options?: unknown) => {
    store.setState((state) => ({ chats: [...state.chats, room] }));
    return room.id;
  });
  store.setState({ createGroup });

  fireEvent.click(screen.getByLabelText('New chat'));
  fireEvent.click(screen.getByRole('menuitem', { name: 'New group' }));
  fireEvent.click(screen.getByRole('checkbox'));
  fireEvent.click(screen.getByRole('button', { name: 'Next' }));
  return createGroup;
}

describe('NewGroupDialog visibility (T-0164)', () => {
  it('defaults to Private and creates without visibility options', async () => {
    const createGroup = openCreateDialog();

    expect(screen.getByLabelText('Group name').className).toContain('well-surface');
    expect(screen.getByRole('radio', { name: 'Private' }).getAttribute('aria-checked')).toBe(
      'true',
    );
    expect(screen.getByRole('button', { name: 'Create' }).getAttribute('data-slot')).toBe('button');
    fireEvent.change(screen.getByLabelText('Group name'), { target: { value: 'Hiking club' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create' }));

    await waitFor(() => expect(createGroup).toHaveBeenCalledWith('Hiking club', ['u-ana'], {}));
  });

  it('creates public with a handle and description when Public is picked', async () => {
    const createGroup = openCreateDialog();

    fireEvent.change(screen.getByLabelText('Group name'), { target: { value: 'Hiking club' } });
    fireEvent.click(screen.getByRole('radio', { name: 'Public' }));
    expect(screen.getByText('Anyone can find and join this group.')).toBeTruthy();

    fireEvent.change(screen.getByLabelText('Group handle'), { target: { value: 'hiking_club' } });
    fireEvent.change(screen.getByLabelText('Group description'), {
      target: { value: 'Trail talk.' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Create' }));

    await waitFor(() =>
      expect(createGroup).toHaveBeenCalledWith('Hiking club', ['u-ana'], {
        description: 'Trail talk.',
        visibility: 'public',
        handle: 'hiking_club',
      }),
    );
  });

  it('refuses to create public without a handle', async () => {
    const createGroup = openCreateDialog();

    fireEvent.change(screen.getByLabelText('Group name'), { target: { value: 'Hiking club' } });
    fireEvent.click(screen.getByRole('radio', { name: 'Public' }));
    fireEvent.click(screen.getByRole('button', { name: 'Create' }));

    expect(await screen.findByText('Choose a handle for the public group.')).toBeTruthy();
    expect(createGroup).not.toHaveBeenCalled();
  });

  it('closes on Escape', () => {
    openCreateDialog();
    expect(screen.getByRole('dialog', { name: 'New group' })).toBeTruthy();

    fireEvent.keyDown(document, { key: 'Escape' });

    expect(screen.queryByRole('dialog', { name: 'New group' })).toBeNull();
  });
});
