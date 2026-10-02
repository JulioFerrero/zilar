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

function renderFlow(props: { inviteCode?: string }) {
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
        <AuthFlow inviteCode={props.inviteCode} heading="You're invited to Zilar" />
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
