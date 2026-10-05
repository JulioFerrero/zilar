import { describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { renderApp } from '@/test/renderApp';
import { ApiError, listBlockedUsers, unblockUser } from '@/lib/api';

vi.mock('@/lib/api', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/lib/api')>();
  return {
    ...original,
    listBlockedUsers: vi.fn(),
    unblockUser: vi.fn(),
  };
});

const listMock = vi.mocked(listBlockedUsers);
const unblockMock = vi.mocked(unblockUser);

const PEOPLE = [
  { userId: 'u-bob', name: 'Bob', handle: 'bob_b', image: null, jid: 'u-bob@zilar.test' },
  { userId: 'u-ana', name: 'Ana', handle: 'ana_a', image: null, jid: null },
  { userId: 'u-nohandle', name: 'No Handle', handle: null, image: null, jid: null },
];

describe('BlockedPage', () => {
  it('lists blocked people with Unblock', async () => {
    listMock.mockResolvedValue(PEOPLE);
    renderApp('/settings/blocked');

    expect(await screen.findByText('Blocked people')).toBeTruthy();
    expect(
      screen.getByText("They are not told. Their contact requests don't reach you."),
    ).toBeTruthy();
    expect(await screen.findByText('Bob')).toBeTruthy();
    expect(screen.getByText('@bob_b')).toBeTruthy();
    expect(screen.getByText('Ana')).toBeTruthy();
    expect(screen.getAllByRole('button', { name: 'Unblock' })).toHaveLength(3);
  });

  it('renders a person without a handle with no @', async () => {
    listMock.mockResolvedValue(PEOPLE);
    renderApp('/settings/blocked');

    expect(await screen.findByText('No Handle')).toBeTruthy();
    expect(screen.queryByText('@null')).toBeNull();
    expect(screen.queryByText('@undefined')).toBeNull();
  });

  it('shows the empty state', async () => {
    listMock.mockResolvedValue([]);
    renderApp('/settings/blocked');

    expect(await screen.findByText("You haven't blocked anyone.")).toBeTruthy();
  });

  it('unblock removes the row', async () => {
    listMock.mockResolvedValue(PEOPLE);
    unblockMock.mockResolvedValue({ blocked: false });
    renderApp('/settings/blocked');

    await screen.findByText('Bob');
    fireEvent.click(screen.getAllByRole('button', { name: 'Unblock' })[0]!);
    await waitFor(() => expect(unblockMock).toHaveBeenCalledWith('u-bob'));
    expect(screen.queryByText('Bob')).toBeNull();
    expect(screen.getByText('Ana')).toBeTruthy();
  });

  it('shows a fixed error sentence', async () => {
    listMock.mockRejectedValueOnce(new ApiError(500, 'request_failed', 'boom'));
    renderApp('/settings/blocked');

    expect(await screen.findByText('Could not load blocked people. Try again.')).toBeTruthy();
  });

  it('shows the unblock failure sentence', async () => {
    listMock.mockResolvedValue(PEOPLE);
    unblockMock.mockRejectedValueOnce(new ApiError(500, 'request_failed', 'boom'));
    renderApp('/settings/blocked');

    await screen.findByText('Bob');
    fireEvent.click(screen.getAllByRole('button', { name: 'Unblock' })[0]!);
    expect(await screen.findByText('Could not unblock. Try again.')).toBeTruthy();
  });
});
