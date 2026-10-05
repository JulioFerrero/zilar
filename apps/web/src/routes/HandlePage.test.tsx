import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { AuthProvider } from '@/auth/AuthProvider';
import { HandlePage } from './HandlePage';

vi.mock('@/lib/handles', () => ({
  ApiError: class ApiError extends Error {
    readonly status: number;
    readonly code: string;
    constructor(status: number, code: string, message: string) {
      super(message);
      this.status = status;
      this.code = code;
    }
  },
  checkHandle: vi.fn(),
  claimHandle: vi.fn(),
  suggestHandleFor: vi.fn(() => 'ada'),
}));

import { checkHandle as handlesCheck, claimHandle as handlesClaim } from '@/lib/handles';

const checkMock = vi.mocked(handlesCheck);
const claimMock = vi.mocked(handlesClaim);

function renderPage(next?: string) {
  return render(
    <AuthProvider
      value={{
        status: 'authenticated',
        user: { id: 'u-1', name: 'Ada', email: 'ada@example.com', handle: null },
        refetch: async () => {},
      }}
    >
      <MemoryRouter initialEntries={[{ pathname: '/welcome/handle', state: { next } }]}>
        <HandlePage />
      </MemoryRouter>
    </AuthProvider>,
  );
}

describe('HandlePage', () => {
  it('shows availability for the suggestion and claims on Continue', async () => {
    checkMock.mockResolvedValue({ available: true });
    claimMock.mockResolvedValue({ handle: 'ada' });
    renderPage();

    expect(await screen.findByDisplayValue('ada')).toBeTruthy();
    await waitFor(() => expect(checkMock).toHaveBeenCalledWith('ada'));
    expect(await screen.findByText('@ada is available')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Continue' }).getAttribute('data-slot')).toBe(
      'button',
    );

    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    await waitFor(() => expect(claimMock).toHaveBeenCalledWith('ada'));
  });

  it('shows the exact reason when the handle is taken', async () => {
    checkMock.mockResolvedValue({ available: false, reason: 'taken' });
    claimMock.mockResolvedValue({ handle: 'ada' });
    renderPage();

    expect(await screen.findByText('That username is taken. Try another.')).toBeTruthy();
  });

  it('skips forward without claiming and records the dismissal', async () => {
    const { hasDismissedHandleGate } = await import('@/lib/handleGate');
    checkMock.mockResolvedValue({ available: true });
    renderPage('/j/abc');
    fireEvent.click(screen.getByRole('button', { name: 'Skip for now' }));
    expect(claimMock).not.toHaveBeenCalled();
    // The dismissal is recorded for this user id: the gate honors it.
    expect(hasDismissedHandleGate('u-1')).toBe(true);
  });
});
