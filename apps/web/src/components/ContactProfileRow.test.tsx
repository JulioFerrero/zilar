import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { AuthProvider } from '@/auth/AuthProvider';
import { ChatStoreProvider } from '@/store/ChatStoreProvider';
import { createChatStore } from '@/store/store';
import { ContactProfileRow } from './ContactProfileRow';
import {
  ApiError,
  blockUser,
  sendContactRequest,
  unblockUser,
  type HandleProfile,
} from '@/lib/api';

vi.mock('@/lib/api', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/lib/api')>();
  return {
    ...original,
    sendContactRequest: vi.fn(),
    listContactRequests: vi.fn(async () => ({ incoming: [], outgoing: [] })),
    acceptContactRequest: vi.fn(),
    declineContactRequest: vi.fn(),
    cancelContactRequest: vi.fn(),
    blockUser: vi.fn(),
    unblockUser: vi.fn(),
  };
});

const blockMock = vi.mocked(blockUser);
const sendMock = vi.mocked(sendContactRequest);
const unblockMock = vi.mocked(unblockUser);

const PROFILE: HandleProfile = {
  userId: 'u-bob',
  name: 'Bob',
  handle: 'bob_b',
  image: null,
  relation: 'none',
};

function renderRow(profile: HandleProfile, onRelationChange: (next: HandleProfile) => void) {
  return render(
    <AuthProvider
      value={{
        status: 'authenticated',
        user: { id: 'u-you', name: 'You', email: 'you@zilar.test', handle: 'you' },
        refetch: async () => {},
      }}
    >
      <ChatStoreProvider store={createChatStore()}>
        <MemoryRouter>
          <ContactProfileRow profile={profile} onRelationChange={onRelationChange} />
        </MemoryRouter>
      </ChatStoreProvider>
    </AuthProvider>,
  );
}

describe('ContactProfileRow block actions', () => {
  it('Block → confirm → blocked line + Unblock', async () => {
    blockMock.mockResolvedValue({ blocked: true });
    const onRelationChange = vi.fn();
    const { rerender } = renderRow(PROFILE, onRelationChange);

    fireEvent.click(screen.getByRole('button', { name: 'Block' }));
    expect(screen.getByText(/Block Bob\? They are not told/)).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Confirm block' }));
    await waitFor(() => expect(blockMock).toHaveBeenCalledWith('u-bob'));
    expect(onRelationChange).toHaveBeenCalledWith({ ...PROFILE, relation: 'blocked' });

    rerender(
      <AuthProvider
        value={{
          status: 'authenticated',
          user: { id: 'u-you', name: 'You', email: 'you@zilar.test', handle: 'you' },
          refetch: async () => {},
        }}
      >
        <ChatStoreProvider store={createChatStore()}>
          <MemoryRouter>
            <ContactProfileRow
              profile={{ ...PROFILE, relation: 'blocked' }}
              onRelationChange={onRelationChange}
            />
          </MemoryRouter>
        </ChatStoreProvider>
      </AuthProvider>,
    );
    expect(screen.getByText('You blocked this person.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Unblock' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Add contact' })).toBeNull();
  });

  it('Cancel keeps the state and unblock returns to none', async () => {
    const onRelationChange = vi.fn();
    renderRow(PROFILE, onRelationChange);

    fireEvent.click(screen.getByRole('button', { name: 'Block' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(blockMock).not.toHaveBeenCalled();
    expect(onRelationChange).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Add contact' })).toBeTruthy();

    unblockMock.mockResolvedValue({ blocked: false });
    const changed = vi.fn();
    renderRow({ ...PROFILE, relation: 'blocked' }, changed);
    fireEvent.click(screen.getAllByRole('button', { name: 'Unblock' })[0]!);
    await waitFor(() => expect(unblockMock).toHaveBeenCalledWith('u-bob'));
    expect(changed).toHaveBeenCalledWith({ ...PROFILE, relation: 'none' });
  });

  it('shows fixed sentences on block and unblock failures', async () => {
    blockMock.mockRejectedValueOnce(new ApiError(500, 'request_failed', 'boom'));
    renderRow(PROFILE, vi.fn());
    fireEvent.click(screen.getByRole('button', { name: 'Block' }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirm block' }));
    expect(await screen.findByText('Could not block. Try again.')).toBeTruthy();

    blockMock.mockRejectedValueOnce(new ApiError(429, 'rate_limited', 'slow down'));
    fireEvent.click(screen.getByRole('button', { name: 'Confirm block' }));
    expect(await screen.findByText('Too many tries — wait a little and try again.')).toBeTruthy();
  });

  it('shows the unblock failure sentence', async () => {
    unblockMock.mockRejectedValueOnce(new ApiError(500, 'request_failed', 'boom'));
    renderRow({ ...PROFILE, relation: 'blocked' }, vi.fn());
    fireEvent.click(screen.getByRole('button', { name: 'Unblock' }));
    expect(await screen.findByText('Could not unblock. Try again.')).toBeTruthy();
  });

  it('hides the Block action for self', () => {
    renderRow({ ...PROFILE, relation: 'self' }, vi.fn());
    expect(screen.queryByRole('button', { name: 'Block' })).toBeNull();
  });

  it('shows the fixed sentence when the person blocked the request', async () => {
    sendMock.mockRejectedValueOnce(new ApiError(409, 'blocked', 'Unblock this person first'));
    renderRow(PROFILE, vi.fn());
    fireEvent.click(screen.getByRole('button', { name: 'Add contact' }));
    expect(await screen.findByText('Unblock this person first.')).toBeTruthy();
  });
});
