import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { AuthProvider } from '@/auth/AuthProvider';
import { AuthFlow } from './AuthFlow';
import { authClient, sendSignInCode, verifySignInCode } from '@/lib/auth';

vi.mock('@/lib/auth', () => ({
  INVITE_HEADER: 'x-zilar-invite',
  authClient: { getSession: vi.fn(async () => ({ data: { user: { name: 'You' } } })) },
  sendSignInCode: vi.fn(),
  verifySignInCode: vi.fn(),
  signOut: vi.fn(),
}));

const sendMock = vi.mocked(sendSignInCode);
const verifyMock = vi.mocked(verifySignInCode);
const getSessionMock = vi.mocked(authClient.getSession);

function renderFlow(props: {
  inviteCode?: string;
  initialEmail?: string;
  initialStep?: 'email' | 'code';
}) {
  const refetch = vi.fn(async () => {});
  render(
    <AuthProvider
      value={{
        status: 'guest',
        user: undefined,
        refetch,
      }}
    >
      <MemoryRouter>
        <AuthFlow
          inviteCode={props.inviteCode}
          heading="You're invited to Zilar"
          initialEmail={props.initialEmail}
          initialStep={props.initialStep}
        />
      </MemoryRouter>
    </AuthProvider>,
  );
  return { refetch };
}

async function enterEmail(email: string): Promise<void> {
  fireEvent.change(screen.getByLabelText('Email'), { target: { value: email } });
  fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
  await waitFor(() => expect(screen.getByLabelText('Digit 1')).toBeTruthy());
}

function pasteCode(code: string): void {
  fireEvent.paste(screen.getByLabelText('Digit 1'), {
    clipboardData: { getData: () => code },
  });
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('AuthFlow', () => {
  it('sends the invite header on both the send-code and sign-in requests', async () => {
    sendMock.mockResolvedValue({ data: { success: true } } as never);
    verifyMock.mockResolvedValue({ data: { user: { name: 'You' } } } as never);
    renderFlow({ inviteCode: 'CODE123' });

    await enterEmail('friend@example.com');
    expect(sendMock).toHaveBeenCalledWith('friend@example.com', 'CODE123');

    pasteCode('123456');
    await waitFor(() =>
      expect(verifyMock).toHaveBeenCalledWith('friend@example.com', '123456', 'CODE123'),
    );
    expect(getSessionMock).toHaveBeenCalled();
  });

  it('logs in without an invite header for existing users', async () => {
    sendMock.mockResolvedValue({ data: { success: true } } as never);
    renderFlow({});

    await enterEmail('existing@example.com');
    expect(sendMock).toHaveBeenCalledWith('existing@example.com', undefined);
  });

  it('shows "Wrong code" for an invalid code', async () => {
    sendMock.mockResolvedValue({ data: { success: true } } as never);
    verifyMock.mockResolvedValue({ error: { code: 'INVALID_OTP', message: 'invalid' } } as never);
    renderFlow({ inviteCode: 'CODE123' });

    await enterEmail('friend@example.com');
    pasteCode('000000');

    await waitFor(() => expect(screen.getByText('Wrong code')).toBeTruthy());
  });

  it('shows the too many attempts error', async () => {
    sendMock.mockResolvedValue({ data: { success: true } } as never);
    verifyMock.mockResolvedValue({
      error: { code: 'TOO_MANY_ATTEMPTS', message: 'stop' },
    } as never);
    renderFlow({});

    await enterEmail('friend@example.com');
    pasteCode('000000');

    await waitFor(() =>
      expect(screen.getByText('Too many attempts, try again later')).toBeTruthy(),
    );
  });
});

const EMAIL_HINT = 'New here? Open the invite link you were sent first, then sign in.';
const CODE_HINT =
  'No email after a minute? Check spam, and if you are new here you need an invite link from whoever runs this server.';

describe('AuthFlow sign-in hints (T-0180)', () => {
  it('shows the email-step hint without an invite code, not with one', () => {
    renderFlow({});
    expect(screen.getByText(EMAIL_HINT)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Continue' }).getAttribute('data-slot')).toBe(
      'button',
    );
    cleanup();

    renderFlow({ inviteCode: 'CODE123' });
    expect(screen.queryByText(EMAIL_HINT)).toBeNull();
  });

  it('shows the code-step hint without an invite code, not with one', async () => {
    sendMock.mockResolvedValue({ data: { success: true } } as never);
    renderFlow({});
    await enterEmail('existing@example.com');
    expect(
      screen.getByText(
        'No email after a minute? Check spam, and if you are new here you need an invite link from whoever runs this server.',
      ),
    ).toBeTruthy();
    cleanup();

    renderFlow({ inviteCode: 'CODE123' });
    await enterEmail('friend@example.com');
    expect(screen.queryByText(/No email after a minute\?/)).toBeNull();
  });

  it('shows neither hint on the setup page step (invite code set, code step)', async () => {
    sendMock.mockResolvedValue({ data: { success: true } } as never);
    renderFlow({ inviteCode: 'CODE', initialEmail: 'admin@example.com', initialStep: 'code' });

    await waitFor(() => expect(screen.getByLabelText('Digit 1')).toBeTruthy());
    expect(screen.queryByText(EMAIL_HINT)).toBeNull();
    expect(screen.queryByText(CODE_HINT)).toBeNull();
  });

  it('keeps Resend code on the login code step and leaks nothing about accounts', async () => {
    sendMock.mockResolvedValue({ data: { success: true } } as never);
    renderFlow({});
    await enterEmail('existing@example.com');

    // Right after the code step opens, the resend slot shows the 30s
    // countdown and flips to the "Resend code" button once it elapses.
    expect(
      screen.queryByRole('button', { name: 'Resend code' }) ?? screen.getByText(/Resend in \d+s/),
    ).toBeTruthy();
    const body = document.body.textContent ?? '';
    for (const leaked of ['account', 'registered', 'exists']) {
      expect(body.toLowerCase()).not.toContain(leaked);
    }
    expect(CODE_HINT.toLowerCase()).not.toContain('account');
    expect(CODE_HINT.toLowerCase()).not.toContain('registered');
    expect(CODE_HINT.toLowerCase()).not.toContain('exists');
    expect(EMAIL_HINT.toLowerCase()).not.toContain('account');
    expect(EMAIL_HINT.toLowerCase()).not.toContain('registered');
    expect(EMAIL_HINT.toLowerCase()).not.toContain('exists');
  });
});
