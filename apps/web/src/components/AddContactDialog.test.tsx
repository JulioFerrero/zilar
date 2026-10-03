import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { AddContactDialog } from './AddContactDialog';
import { lookupByHandle, sendContactRequest } from '@/lib/api';

vi.mock('@/lib/api', () => ({
  ApiError: class ApiError extends Error {
    readonly status: number;
    readonly code: string;
    constructor(status: number, code: string, message: string) {
      super(message);
      this.status = status;
      this.code = code;
    }
  },
  lookupByHandle: vi.fn(),
  sendContactRequest: vi.fn(),
}));

const lookupMock = vi.mocked(lookupByHandle);
const sendMock = vi.mocked(sendContactRequest);

const PROFILE = {
  userId: 'u-bob',
  name: 'Bob',
  handle: 'bob_b',
  image: null,
  relation: 'none' as const,
};

function renderDialog(initialHandle?: string) {
  return render(
    <MemoryRouter>
      <AddContactDialog initialHandle={initialHandle} onClose={() => {}} />
    </MemoryRouter>,
  );
}

describe('AddContactDialog', () => {
  it('looks up the typed handle and sends a request', async () => {
    lookupMock.mockResolvedValue(PROFILE);
    sendMock.mockResolvedValue({
      request: {
        id: 'r-1',
        fromUserId: 'u-me',
        toUserId: 'u-bob',
        status: 'pending',
        createdAt: new Date().toISOString(),
      },
    });
    renderDialog();

    fireEvent.change(screen.getByLabelText('Username'), { target: { value: '@bob_b' } });
    expect(await screen.findByText('Bob')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Send request' }));
    await waitFor(() => expect(sendMock).toHaveBeenCalledWith('bob_b'));
    expect(await screen.findByText('Request sent.')).toBeTruthy();
  });

  it('shows "already contacts" without a send button', async () => {
    lookupMock.mockResolvedValue({ ...PROFILE, relation: 'contact' as const });
    renderDialog('bob_b');
    expect(await screen.findByText("You're already contacts.")).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Send request' })).toBeNull();
  });

  it('shows a missing state for an unknown handle', async () => {
    const { ApiError } = await import('@/lib/api');
    lookupMock.mockRejectedValue(new ApiError(404, 'not_found', 'No user with that username'));
    renderDialog('nobody_xyz');
    expect(await screen.findByText('No one with that username. Check the spelling.')).toBeTruthy();
  });

  it('re-seeds when the prefill handle changes', async () => {
    lookupMock.mockResolvedValue(PROFILE);
    const view = renderDialog('alice_w');
    expect(screen.getByDisplayValue('alice_w')).toBeTruthy();

    view.rerender(
      <MemoryRouter>
        <AddContactDialog initialHandle="bob_b" onClose={() => {}} />
      </MemoryRouter>,
    );
    expect(screen.getByDisplayValue('bob_b')).toBeTruthy();
  });
});
