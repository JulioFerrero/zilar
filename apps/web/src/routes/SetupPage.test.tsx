import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { AuthProvider } from '@/auth/AuthProvider';
import { AuthFlow } from '@/components/auth/AuthFlow';
import { authClient, sendSignInCode, verifySignInCode } from '@/lib/auth';
import * as api from '@/lib/api';
import { LoginPage } from './LoginPage';
import { SetupPage } from './SetupPage';

vi.mock('@/lib/auth', () => ({
  INVITE_HEADER: 'x-zilar-invite',
  authClient: { getSession: vi.fn(async () => ({ data: { user: { name: 'Admin' } } })) },
  sendSignInCode: vi.fn(),
  verifySignInCode: vi.fn(),
  signOut: vi.fn(),
}));

const verifyMock = vi.mocked(verifySignInCode);
const getSessionMock = vi.mocked(authClient.getSession);

function guestAuth() {
  return {
    status: 'guest' as const,
    user: undefined,
    refetch: async () => {},
  };
}

function renderSetup(initialPath = '/setup') {
  render(
    <AuthProvider value={guestAuth()}>
      <MemoryRouter initialEntries={[initialPath]}>
        <Routes>
          <Route path="/setup" element={<SetupPage />} />
          <Route path="/login" element={<div>Login page</div>} />
        </Routes>
      </MemoryRouter>
    </AuthProvider>,
  );
}

function renderLogin() {
  render(
    <AuthProvider value={guestAuth()}>
      <MemoryRouter initialEntries={['/login']}>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/setup" element={<div>Setup page</div>} />
        </Routes>
      </MemoryRouter>
    </AuthProvider>,
  );
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

describe('SetupPage (T-0161)', () => {
  it('redirects to /login when setup is not needed', async () => {
    vi.spyOn(api, 'getSetupStatus').mockResolvedValue({ needsSetup: false, mailConfigured: true });

    renderSetup();

    await waitFor(() => expect(screen.getByText('Login page')).toBeTruthy());
  });

  it('asks for the admin email first, then the key', async () => {
    vi.spyOn(api, 'getSetupStatus').mockResolvedValue({ needsSetup: true, mailConfigured: false });
    const postSpy = vi.spyOn(api, 'postSetup').mockResolvedValue({ ok: true, inviteCode: 'X' });

    renderSetup();

    // Step 1: email only — no key field yet.
    await waitFor(() => expect(screen.getByLabelText('Admin email')).toBeTruthy());
    expect(screen.queryByLabelText('Resend API key')).toBeNull();
    expect(screen.getByRole('button', { name: 'Next' }).getAttribute('data-slot')).toBe('button');
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    await waitFor(() => expect(screen.getByText('Enter a valid admin email address')).toBeTruthy());
    expect(postSpy).not.toHaveBeenCalled();

    // Step 2: the key field appears, prefilled sender, email kept.
    fireEvent.change(screen.getByLabelText('Admin email'), {
      target: { value: 'admin@example.com' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    await waitFor(() => expect(screen.getByLabelText('Resend API key')).toBeTruthy());
    expect((screen.getByLabelText('From address') as HTMLInputElement).value).toBe(
      'Zilar <onboarding@resend.dev>',
    );
    expect(screen.queryByLabelText('Admin email')).toBeNull();

    // Back returns to step 1 with the email kept.
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    await waitFor(() =>
      expect((screen.getByLabelText('Admin email') as HTMLInputElement).value).toBe(
        'admin@example.com',
      ),
    );
  });

  it('shows the mail-failed error on step 2 and keeps the typed values', async () => {
    vi.spyOn(api, 'getSetupStatus').mockResolvedValue({ needsSetup: true, mailConfigured: false });
    vi.spyOn(api, 'postSetup').mockRejectedValue(
      new api.ApiError(422, 'mail_send_failed', 'The test email could not be sent.'),
    );

    renderSetup();

    await waitFor(() => expect(screen.getByLabelText('Admin email')).toBeTruthy());
    fireEvent.change(screen.getByLabelText('Admin email'), {
      target: { value: 'admin@example.com' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));

    await waitFor(() => expect(screen.getByLabelText('Resend API key')).toBeTruthy());
    fireEvent.change(screen.getByLabelText('Resend API key'), { target: { value: 're_bad' } });
    fireEvent.change(screen.getByLabelText('From address'), {
      target: { value: 'Zilar <no-reply@example.com>' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Send my code' }));

    await waitFor(() => expect(screen.getByText(/The test email could not be sent/)).toBeTruthy());
    // Still on step 2 with everything kept.
    expect((screen.getByLabelText('Resend API key') as HTMLInputElement).value).toBe('re_bad');
    expect((screen.getByLabelText('From address') as HTMLInputElement).value).toBe(
      'Zilar <no-reply@example.com>',
    );
  });

  it('goes straight to the code step on success, with the invite attached', async () => {
    vi.spyOn(api, 'getSetupStatus').mockResolvedValue({ needsSetup: true, mailConfigured: false });
    const postSpy = vi
      .spyOn(api, 'postSetup')
      .mockResolvedValue({ ok: true, inviteCode: 'SETUPCODE123' });
    verifyMock.mockResolvedValue({ data: { user: { name: 'Admin' } } } as never);

    renderSetup();

    await waitFor(() => expect(screen.getByLabelText('Admin email')).toBeTruthy());
    fireEvent.change(screen.getByLabelText('Admin email'), {
      target: { value: 'admin@example.com' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));

    await waitFor(() => expect(screen.getByLabelText('Resend API key')).toBeTruthy());
    fireEvent.change(screen.getByLabelText('Resend API key'), { target: { value: 're_good' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send my code' }));

    await waitFor(() =>
      expect(postSpy).toHaveBeenCalledWith({
        resendApiKey: 're_good',
        from: 'Zilar <onboarding@resend.dev>',
        adminEmail: 'admin@example.com',
      }),
    );
    // The code step shows (the code was already emailed by the setup call).
    await waitFor(() => expect(screen.getByLabelText('Digit 1')).toBeTruthy());

    fireEvent.paste(screen.getByLabelText('Digit 1'), {
      clipboardData: { getData: () => '123456' },
    });
    await waitFor(() =>
      expect(verifyMock).toHaveBeenCalledWith('admin@example.com', '123456', 'SETUPCODE123'),
    );
    expect(getSessionMock).toHaveBeenCalled();
  });

  it('shows an error with Retry when the status check fails', async () => {
    const statusSpy = vi
      .spyOn(api, 'getSetupStatus')
      .mockRejectedValueOnce(new api.ApiError(0, 'network_error', 'Could not reach the server'))
      .mockResolvedValue({ needsSetup: true, mailConfigured: false });

    renderSetup();

    await waitFor(() => expect(screen.getByText('Could not reach the server')).toBeTruthy());
    expect(screen.queryByLabelText('Admin email')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));

    await waitFor(() => expect(screen.getByLabelText('Admin email')).toBeTruthy());
    expect(statusSpy).toHaveBeenCalledTimes(2);
  });

  it('validates the key before calling the API', async () => {
    vi.spyOn(api, 'getSetupStatus').mockResolvedValue({ needsSetup: true, mailConfigured: false });
    const postSpy = vi.spyOn(api, 'postSetup').mockResolvedValue({ ok: true, inviteCode: 'X' });

    renderSetup();

    await waitFor(() => expect(screen.getByLabelText('Admin email')).toBeTruthy());
    fireEvent.change(screen.getByLabelText('Admin email'), {
      target: { value: 'admin@example.com' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));

    await waitFor(() => expect(screen.getByLabelText('Resend API key')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'Send my code' }));

    await waitFor(() => expect(screen.getByText('Enter your Resend API key')).toBeTruthy());
    expect(postSpy).not.toHaveBeenCalled();
  });
});

describe('LoginPage setup link (T-0161)', () => {
  it('shows the setup link instead of the form when setup is needed', async () => {
    vi.spyOn(api, 'getSetupStatus').mockResolvedValue({ needsSetup: true, mailConfigured: false });

    renderLogin();

    await waitFor(() =>
      expect(screen.getByRole('link', { name: 'Finish setting up this server' })).toBeTruthy(),
    );
    expect(screen.queryByLabelText('Email')).toBeNull();
  });

  it('shows the sign-in form when setup is done', async () => {
    vi.spyOn(api, 'getSetupStatus').mockResolvedValue({ needsSetup: false, mailConfigured: true });

    renderLogin();

    await waitFor(() => expect(screen.getByLabelText('Email')).toBeTruthy());
    expect(screen.queryByRole('link', { name: 'Finish setting up this server' })).toBeNull();
  });
});

describe('AuthFlow setup props', () => {
  it('starts at the code step with a pre-filled email', async () => {
    vi.mocked(sendSignInCode).mockResolvedValue({ data: { success: true } } as never);
    render(
      <AuthProvider value={guestAuth()}>
        <MemoryRouter>
          <AuthFlow
            inviteCode="CODE"
            heading="Check your inbox"
            initialEmail="admin@example.com"
            initialStep="code"
          />
        </MemoryRouter>
      </AuthProvider>,
    );

    await waitFor(() => expect(screen.getByLabelText('Digit 1')).toBeTruthy());
    expect(screen.getByText('admin@example.com')).toBeTruthy();
  });
});
