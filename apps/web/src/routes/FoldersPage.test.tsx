import { describe, expect, it, vi, beforeEach } from 'vitest';
import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import type { ChatFolder } from '@zilar/chat-core';
import { renderApp } from '@/test/renderApp';
import { ApiError, listChatFolders, reorderChatFolders } from '@/lib/api';

vi.mock('@/lib/api', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/lib/api')>();
  return { ...original, listChatFolders: vi.fn(), reorderChatFolders: vi.fn() };
});

const listMock = vi.mocked(listChatFolders);
const reorderMock = vi.mocked(reorderChatFolders);

function folder(
  id: string,
  name: string,
  position: number,
  extra?: Partial<ChatFolder>,
): ChatFolder {
  return {
    id,
    name,
    icon: 'folder',
    position,
    includeTypes: ['dm'],
    includeChats: ['c-ana'],
    excludeChats: [],
    excludeMuted: false,
    excludeRead: false,
    ...extra,
  };
}

describe('FoldersPage', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    // The page syncs folders on mount: keep the promise pending by default
    // so tests that set the store directly are not overwritten.
    listMock.mockReturnValue(new Promise(() => {}));
  });

  it('syncs folders on mount even with an empty store', async () => {
    const server = [folder('f-a', 'First', 0), folder('f-b', 'Second', 1)];
    listMock.mockResolvedValue(server);
    renderApp('/settings/folders');

    expect(await screen.findByRole('button', { name: 'Edit First' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Edit Second' })).toBeTruthy();
  });

  it('lists folders in order with summaries', () => {
    const { store } = renderApp('/settings/folders');
    act(() => {
      store
        .getState()
        .setFolders([
          folder('f-b', 'Second', 1),
          folder('f-a', 'First', 0),
          folder('f-c', 'Types only', 2, { includeTypes: ['dm'], includeChats: [] }),
          folder('f-d', 'Empty', 3, { includeTypes: [], includeChats: [] }),
        ]);
    });

    expect(screen.getByText('Chat folders')).toBeTruthy();
    const rows = screen.getAllByRole('button', { name: /^Edit / });
    expect(rows[0]?.getAttribute('aria-label')).toBe('Edit First');
    expect(rows[1]?.getAttribute('aria-label')).toBe('Edit Second');
    expect(screen.getAllByText('Personal chats, 1 chat')).toHaveLength(2);
    expect(screen.getByText('Personal chats')).toBeTruthy();
    expect(screen.getByText('No rules yet')).toBeTruthy();
  });

  it('keyboard reorder calls reorderChatFolders with the new ids and rolls back on error', async () => {
    const { store } = renderApp('/settings/folders');
    act(() => {
      store.getState().setFolders([folder('f-a', 'First', 0), folder('f-b', 'Second', 1)]);
    });
    reorderMock.mockRejectedValueOnce(new ApiError(500, 'request_failed', 'boom'));

    fireEvent.keyDown(screen.getByRole('button', { name: 'Reorder Second' }), {
      key: 'ArrowUp',
      altKey: true,
    });

    await waitFor(() => expect(reorderMock).toHaveBeenCalledWith(['f-b', 'f-a']));
    expect(store.getState().folders.map((entry) => entry.id)).toEqual(['f-a', 'f-b']);
    expect(await screen.findByText('Could not reorder folders. Try again.')).toBeTruthy();
  });

  it('ignores a second reorder while one is in flight', async () => {
    const { store } = renderApp('/settings/folders');
    act(() => {
      store
        .getState()
        .setFolders([
          folder('f-a', 'First', 0),
          folder('f-b', 'Second', 1),
          folder('f-c', 'Third', 2),
        ]);
    });
    let resolveReorder!: (ordered: ChatFolder[]) => void;
    reorderMock.mockReturnValueOnce(
      new Promise<ChatFolder[]>((resolve) => {
        resolveReorder = resolve;
      }),
    );

    fireEvent.keyDown(screen.getByRole('button', { name: 'Reorder Second' }), {
      key: 'ArrowUp',
      altKey: true,
    });

    expect(reorderMock).toHaveBeenCalledTimes(1);
    expect(reorderMock).toHaveBeenCalledWith(['f-b', 'f-a', 'f-c']);
    expect(
      screen.getByRole('button', { name: 'Reorder Second' }).getAttribute('disabled'),
    ).not.toBeNull();

    fireEvent.keyDown(screen.getByRole('button', { name: 'Reorder Third' }), {
      key: 'ArrowUp',
      altKey: true,
    });
    expect(reorderMock).toHaveBeenCalledTimes(1);

    const ordered = [
      folder('f-b', 'Second', 0),
      folder('f-a', 'First', 1),
      folder('f-c', 'Third', 2),
    ];
    await act(async () => {
      resolveReorder(ordered);
    });
    expect(store.getState().folders.map((entry) => entry.id)).toEqual(['f-b', 'f-a', 'f-c']);
    expect(
      screen.getByRole('button', { name: 'Reorder Second' }).getAttribute('disabled'),
    ).toBeNull();
  });

  it('hides Create at 20 folders with the limit note', () => {
    const { store } = renderApp('/settings/folders');
    act(() => {
      store
        .getState()
        .setFolders(
          Array.from({ length: 20 }, (_, index) => folder(`f-${index}`, `Folder ${index}`, index)),
        );
    });

    expect(screen.queryByRole('button', { name: 'Create new folder' })).toBeNull();
    expect(screen.getByText('You can have up to 20 folders.')).toBeTruthy();
  });
});
