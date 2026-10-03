import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { AuthProvider } from '@/auth/AuthProvider';
import { ProfileSettingsSection } from './ProfileSettingsSection';
import { claimHandle, checkHandle } from '@/lib/api';

vi.mock('@/lib/api', () => ({
  ApiError: class ApiError extends Error {
    readonly status: number;
    readonly code: string;
    readonly detail: Record<string, unknown>;
    constructor(
      status: number,
      code: string,
      message: string,
      detail: Record<string, unknown> = {},
    ) {
      super(message);
      this.status = status;
      this.code = code;
      this.detail = detail;
    }
  },
  claimHandle: vi.fn(),
  checkHandle: vi.fn(),
}));

vi.mock('@/lib/clipboard', () => ({ copyText: vi.fn(async () => {}) }));

const claimMock = vi.mocked(claimHandle);
const checkMock = vi.mocked(checkHandle);

function renderSection(handle: string | null) {
  return render(
    <AuthProvider
      value={{
        status: 'authenticated',
        user: { id: 'u-1', name: 'Ada', email: 'ada@example.com', handle },
        refetch: async () => {},
      }}
    >
      <MemoryRouter>
        <ProfileSettingsSection />
      </MemoryRouter>
    </AuthProvider>,
  );
}

describe('ProfileSettingsSection', () => {
  it('saves the edited handle and shows the share link', async () => {
    checkMock.mockResolvedValue({ available: true });
    claimMock.mockResolvedValue({ handle: 'ada_new' });
    renderSection('ada');

    fireEvent.change(screen.getByLabelText('Your @username'), {
      target: { value: 'ada_new' },
    });
    await waitFor(() => expect(checkMock).toHaveBeenCalledWith('ada_new'));
    const saveButton = screen.getByRole('button', { name: 'Save username' });
    expect(saveButton.hasAttribute('disabled')).toBe(false);
    fireEvent.click(saveButton);
    await waitFor(() => expect(claimMock).toHaveBeenCalledWith('ada_new'));
    expect(await screen.findByText('Saved.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Copy share link' })).toBeTruthy();
  });

  it('disables Save while the value equals the current handle', async () => {
    renderSection('ada');
    expect(screen.getByRole('button', { name: 'Save username' }).hasAttribute('disabled')).toBe(
      true,
    );
    expect(checkMock).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText('Your @username'), { target: { value: 'ADA' } });
    expect(screen.getByRole('button', { name: 'Save username' }).hasAttribute('disabled')).toBe(
      true,
    );
    expect(checkMock).not.toHaveBeenCalled();
  });

  it('fills the input when the handle arrives after load', async () => {
    const { rerender } = render(
      <AuthProvider
        value={{
          status: 'authenticated',
          user: { id: 'u-1', name: 'Ada', email: 'ada@example.com', handle: undefined },
          refetch: async () => {},
        }}
      >
        <MemoryRouter>
          <ProfileSettingsSection />
        </MemoryRouter>
      </AuthProvider>,
    );
    expect((screen.getByLabelText('Your @username') as HTMLInputElement).value).toBe('');
    rerender(
      <AuthProvider
        value={{
          status: 'authenticated',
          user: { id: 'u-1', name: 'Ada', email: 'ada@example.com', handle: 'ada' },
          refetch: async () => {},
        }}
      >
        <MemoryRouter>
          <ProfileSettingsSection />
        </MemoryRouter>
      </AuthProvider>,
    );
    expect((screen.getByLabelText('Your @username') as HTMLInputElement).value).toBe('ada');
  });

  it('shows the too-soon message from the nextChangeAt body field', async () => {
    const { ApiError } = await import('@/lib/api');
    checkMock.mockResolvedValue({ available: false, reason: 'taken' });
    // The date comes from the body field, not the message: a fixed message
    // proves the web reads the field.
    claimMock.mockRejectedValue(
      new ApiError(409, 'handle_change_too_soon', 'Too soon', {
        nextChangeAt: '2026-10-20T00:00:00.000Z',
      }),
    );
    renderSection('ada');

    fireEvent.change(screen.getByLabelText('Your @username'), { target: { value: 'ada2' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save username' }));
    expect(await screen.findByText(/Next change possible on /)).toBeTruthy();
  });
});
