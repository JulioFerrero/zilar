import { describe, expect, it, vi, beforeEach } from 'vitest';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { FOLDER_NAME_MAX } from '@zilar/chat-core';
import { renderApp } from '@/test/renderApp';
import { ApiError, createChatFolder, deleteChatFolder, patchChatFolder } from '@/lib/api';
import type { ChatFolder } from '@zilar/chat-core';

vi.mock('@/lib/api', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/lib/api')>();
  return {
    ...original,
    createChatFolder: vi.fn(),
    patchChatFolder: vi.fn(),
    deleteChatFolder: vi.fn(),
  };
});

const createMock = vi.mocked(createChatFolder);
const patchMock = vi.mocked(patchChatFolder);
const deleteMock = vi.mocked(deleteChatFolder);

const BASE: ChatFolder = {
  id: 'f-a',
  name: 'Personal',
  icon: 'user',
  position: 0,
  includeTypes: ['dm'],
  includeChats: [],
  excludeChats: [],
  excludeMuted: false,
  excludeRead: false,
};

async function openCreate(): Promise<void> {
  renderApp('/settings/folders');
  fireEvent.click(await screen.findByRole('button', { name: 'Create new folder' }));
}

describe('FolderEditorDialog', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('create sends the right body and updates the store', async () => {
    const { store } = renderApp('/settings/folders');
    createMock.mockResolvedValue({ ...BASE, id: 'f-new', name: 'Work' });
    fireEvent.click(await screen.findByRole('button', { name: 'Create new folder' }));

    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Work' } });
    fireEvent.click(screen.getByRole('radio', { name: 'briefcase' }));
    fireEvent.click(screen.getByRole('switch', { name: 'Groups' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Save' }));

    await waitFor(() =>
      expect(createMock).toHaveBeenCalledWith({
        name: 'Work',
        icon: 'briefcase',
        includeTypes: ['group'],
        includeChats: [],
        excludeChats: [],
        excludeMuted: false,
        excludeRead: false,
      }),
    );
    expect(store.getState().folders.some((entry) => entry.id === 'f-new')).toBe(true);
  });

  it('Save is disabled with an empty name or nothing included', async () => {
    await openCreate();
    const save = screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement;
    expect(save.disabled).toBe(true);

    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Work' } });
    fireEvent.click(screen.getByRole('switch', { name: 'Personal chats' }));
    expect((screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement).disabled).toBe(
      false,
    );

    fireEvent.change(screen.getByLabelText('Name'), { target: { value: '   ' } });
    expect((screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('shows the name counter capped at 24 and picks an icon', async () => {
    await openCreate();
    fireEvent.change(screen.getByLabelText('Name'), {
      target: { value: `${'a'.repeat(FOLDER_NAME_MAX)}extra` },
    });
    expect(screen.getByTestId('folder-name-counter').textContent).toBe(
      `${FOLDER_NAME_MAX}/${FOLDER_NAME_MAX}`,
    );

    fireEvent.click(screen.getByRole('radio', { name: 'star' }));
    expect(screen.getByRole('radio', { name: 'star' }).getAttribute('aria-checked')).toBe('true');
  });

  it('caps the include and exclude pickers at 100', async () => {
    const many = Array.from({ length: 101 }, (_, index) => ({
      id: `c-${index}`,
      title: `Chat ${index}`,
      kind: 'dm' as const,
      isAI: false,
      space: 'personal' as const,
      unread: 0,
      muted: false,
    }));
    const { store } = renderApp('/settings/folders', { chats: many });
    act(() => {
      store
        .getState()
        .setFolders([
          { ...BASE, includeChats: Array.from({ length: 100 }, (_, index) => `c-${index}`) },
        ]);
    });
    fireEvent.click(await screen.findByRole('button', { name: 'Edit Personal' }));

    const showSection = within(screen.getByRole('region', { name: 'Show these chats' }));
    const hideSection = within(screen.getByRole('region', { name: 'Hide' }));
    expect(showSection.getByText('100 of 100 selected')).toBeTruthy();
    expect(
      (showSection.getByRole('checkbox', { name: 'Chat 100' }) as HTMLButtonElement).disabled,
    ).toBe(true);

    fireEvent.click(showSection.getByRole('checkbox', { name: 'Chat 0' }));
    expect(showSection.getByText('99 of 100 selected')).toBeTruthy();
    expect(
      (showSection.getByRole('checkbox', { name: 'Chat 100' }) as HTMLButtonElement).disabled,
    ).toBe(false);
    expect(hideSection.getByText('0 of 100 selected')).toBeTruthy();
  });

  it('filters each picker with its own search field', async () => {
    const chats = [
      {
        id: 'c-ana',
        title: 'Ana',
        kind: 'dm' as const,
        isAI: false,
        space: 'personal' as const,
        unread: 0,
        muted: false,
      },
      {
        id: 'c-group',
        title: 'Test group',
        kind: 'group' as const,
        isAI: false,
        space: 'personal' as const,
        unread: 0,
        muted: false,
      },
    ];
    renderApp('/settings/folders', { chats });
    fireEvent.click(await screen.findByRole('button', { name: 'Create new folder' }));

    const showSection = within(screen.getByRole('region', { name: 'Show these chats' }));
    fireEvent.change(showSection.getByLabelText('Search add chats'), {
      target: { value: 'ana' },
    });
    expect(showSection.getByRole('checkbox', { name: 'Ana' })).toBeTruthy();
    expect(showSection.queryByRole('checkbox', { name: 'Test group' })).toBeNull();

    const hideSection = within(screen.getByRole('region', { name: 'Hide' }));
    expect(hideSection.getByRole('checkbox', { name: 'Test group' })).toBeTruthy();
  });

  it('shows picked chats that are no longer pickable as removable rows', async () => {
    const chats = [
      {
        id: 'c-archived',
        title: 'Old chat',
        kind: 'dm' as const,
        isAI: false,
        space: 'personal' as const,
        unread: 0,
        muted: false,
        archived: true,
      },
    ];
    const { store } = renderApp('/settings/folders', { chats });
    act(() => {
      store.getState().setFolders([{ ...BASE, includeChats: ['c-archived'] }]);
    });
    fireEvent.click(await screen.findByRole('button', { name: 'Edit Personal' }));

    expect(screen.getByText('(archived)')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Remove Old chat' }));
    expect(screen.queryByText('(archived)')).toBeNull();
  });

  it('delete confirm calls deleteChatFolder and closes', async () => {
    const { store } = renderApp('/settings/folders');
    act(() => {
      store.getState().setFolders([BASE]);
    });
    deleteMock.mockResolvedValue(undefined);
    fireEvent.click(await screen.findByRole('button', { name: 'Edit Personal' }));

    fireEvent.click(screen.getByRole('button', { name: 'Delete folder' }));
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));

    await waitFor(() => expect(deleteMock).toHaveBeenCalledWith('f-a'));
    expect(store.getState().folders).toHaveLength(0);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('clicking the delete confirm backdrop keeps the editor open', async () => {
    const { store } = renderApp('/settings/folders');
    act(() => {
      store.getState().setFolders([BASE]);
    });
    fireEvent.click(await screen.findByRole('button', { name: 'Edit Personal' }));
    fireEvent.click(screen.getByRole('button', { name: 'Delete folder' }));

    const confirm = screen.getByRole('dialog', { name: 'Delete folder' });
    fireEvent.click(confirm);
    expect(screen.getByRole('dialog', { name: 'Edit folder Personal' })).toBeTruthy();
    expect(screen.getByLabelText('Name')).toBeTruthy();
    expect(deleteMock).not.toHaveBeenCalled();
  });

  it('Escape closes only the delete confirm', async () => {
    const { store } = renderApp('/settings/folders');
    act(() => {
      store.getState().setFolders([BASE]);
    });
    fireEvent.click(await screen.findByRole('button', { name: 'Edit Personal' }));
    fireEvent.click(screen.getByRole('button', { name: 'Delete folder' }));

    expect(screen.getByRole('dialog', { name: 'Delete folder' })).toBeTruthy();
    fireEvent.keyDown(document, { key: 'Escape' });

    expect(screen.queryByRole('dialog', { name: 'Delete folder' })).toBeNull();
    expect(screen.getByRole('dialog', { name: 'Edit folder Personal' })).toBeTruthy();
  });

  it('patch sends the edited body', async () => {
    const { store } = renderApp('/settings/folders');
    act(() => {
      store.getState().setFolders([BASE]);
    });
    patchMock.mockResolvedValue({ ...BASE, name: 'Renamed' });
    fireEvent.click(await screen.findByRole('button', { name: 'Edit Personal' }));

    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Renamed' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() =>
      expect(patchMock).toHaveBeenCalledWith('f-a', expect.objectContaining({ name: 'Renamed' })),
    );
  });

  it('shows the folder_limit sentence', async () => {
    renderApp('/settings/folders');
    createMock.mockRejectedValueOnce(
      new ApiError(409, 'folder_limit', 'You can have up to 20 folders.'),
    );
    fireEvent.click(await screen.findByRole('button', { name: 'Create new folder' }));

    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Work' } });
    fireEvent.click(screen.getByRole('switch', { name: 'Personal chats' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(await screen.findByText('You can have up to 20 folders.')).toBeTruthy();
  });
});
