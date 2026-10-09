import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { AuthProvider } from '@/auth/AuthProvider';
import { getSetupStatus } from '@/lib/api';
import { authClient, sendSignInCode, verifySignInCode } from '@/lib/auth';
import { LoginPage } from './LoginPage';

vi.mock('@/lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api')>()),
  getSetupStatus: vi.fn(),
}));

vi.mock('@/lib/auth', () => ({
  INVITE_HEADER: 'x-zilar-invite',
  authClient: { getSession: vi.fn() },
  sendSignInCode: vi.fn(),
  verifySignInCode: vi.fn(),
  signOut: vi.fn(),
}));

const setupMock = vi.mocked(getSetupStatus);
const sendMock = vi.mocked(sendSignInCode);
const verifyMock = vi.mocked(verifySignInCode);
const getSessionMock = vi.mocked(authClient.getSession);

const EMAIL_HINT = 'New here? Open the invite link you were sent first, then sign in.';
const CODE_HINT =
  'No email after a minute? Check spam, and if you are new here you need an invite link from whoever runs this server.';

function NameStep() {
  const location = useLocation();
  return <div>Name step {JSON.stringify(location.state)}</div>;
}

function renderLogin(state?: { from: string }) {
  const calls: string[] = [];
  const refetch = vi.fn(async () => {
    calls.push('refetch');
  });
  render(
    <AuthProvider value={{ status: 'guest', user: undefined, refetch }}>
      <MemoryRouter initialEntries={[{ pathname: '/login', state }]}>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/" element={<div>Home page</div>} />
          <Route path="/chats/abc" element={<div>Chat abc</div>} />
          <Route path="/welcome/name" element={<NameStep />} />
          <Route path="/setup" element={<div>Setup page</div>} />
        </Routes>
      </MemoryRouter>
    </AuthProvider>,
  );
  return { refetch, calls };
}

async function enterEmail(email: string): Promise<void> {
  fireEvent.change(await screen.findByLabelText('Email'), { target: { value: email } });
  fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
}

async function reachCodeStep(email = 'friend@example.com'): Promise<void> {
  await enterEmail(email);
  await waitFor(() => expect(screen.getByLabelText('Digit 1')).toBeTruthy());
}

function pasteCode(code: string): void {
  fireEvent.paste(screen.getByLabelText('Digit 1'), {
    clipboardData: { getData: () => code },
  });
}

function digits(): string {
  return [1, 2, 3, 4, 5, 6]
    .map((index) => (screen.getByLabelText(`Digit ${index}`) as HTMLInputElement).value)
    .join('');
}

beforeEach(() => {
  setupMock.mockResolvedValue({ needsSetup: false, mailConfigured: true });
  sendMock.mockResolvedValue({ data: { success: true } } as never);
  verifyMock.mockResolvedValue({ data: { user: { name: 'You' } } } as never);
  getSessionMock.mockResolvedValue({ data: { user: { name: 'You' } } } as never);
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe('LoginPage', () => {
  it('renders the sign-in form with the email hint', async () => {
    renderLogin();

    expect(await screen.findByRole('heading', { name: 'Sign in to Zilar' })).toBeTruthy();
    expect(screen.getByLabelText('Email')).toBeTruthy();
    expect(screen.getByText(EMAIL_HINT)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Continue' })).toBeTruthy();
    expect(setupMock).toHaveBeenCalledTimes(1);
  });

  it('shows the setup link instead of the form while the server needs setup', async () => {
    setupMock.mockResolvedValue({ needsSetup: true, mailConfigured: true });
    renderLogin();

    expect(await screen.findByRole('heading', { name: 'Set up your server' })).toBeTruthy();
    expect(
      screen.getByText(
        'This server has no accounts yet. Finish the one-time setup to create the first admin.',
      ),
    ).toBeTruthy();
    expect(screen.queryByLabelText('Email')).toBeNull();

    const link = screen.getByRole('link', { name: 'Finish setting up this server' });
    expect(link.getAttribute('href')).toBe('/setup');
    fireEvent.click(link);
    expect(await screen.findByText('Setup page')).toBeTruthy();
  });

  it('keeps the sign-in form when the setup status cannot be loaded', async () => {
    setupMock.mockRejectedValue(new Error('network down'));
    renderLogin();

    expect(await screen.findByRole('heading', { name: 'Sign in to Zilar' })).toBeTruthy();
    // Let the rejected request settle: the form stays.
    await act(async () => {
      await Promise.resolve();
    });
    expect(screen.queryByRole('heading', { name: 'Set up your server' })).toBeNull();
    expect(screen.getByLabelText('Email')).toBeTruthy();
  });

  it('rejects an invalid email without sending a code', async () => {
    renderLogin();

    await enterEmail('friend@localhost');

    expect(await screen.findByText('Enter a valid email address')).toBeTruthy();
    expect(sendMock).not.toHaveBeenCalled();
  });

  it('sends the trimmed email and opens the code step', async () => {
    renderLogin();

    await reachCodeStep('  friend@example.com  ');

    expect(sendMock).toHaveBeenCalledTimes(1);
    expect(sendMock).toHaveBeenCalledWith('friend@example.com', undefined);
    expect(screen.getByText('friend@example.com')).toBeTruthy();
    expect(screen.getByText(/Enter the 6-digit code we sent to/)).toBeTruthy();
    expect(screen.getByText(CODE_HINT)).toBeTruthy();
    expect(screen.queryByText(EMAIL_HINT)).toBeNull();
    expect(screen.getByText('Resend in 30s')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Resend code' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Use a different email' })).toBeTruthy();
  });

  it('shows a fixed sentence when sending the code fails, and stays on the email step', async () => {
    sendMock.mockResolvedValue({
      error: { code: 'SERVER_ERROR', message: 'smtp exploded' },
    } as never);
    renderLogin();

    await enterEmail('friend@example.com');

    expect(await screen.findByText('Something went wrong. Try again.')).toBeTruthy();
    expect(screen.queryByText(/smtp exploded/)).toBeNull();
    expect(screen.getByLabelText('Email')).toBeTruthy();
    expect(screen.queryByLabelText('Digit 1')).toBeNull();
    expect((screen.getByRole('button', { name: 'Continue' }) as HTMLButtonElement).disabled).toBe(
      false,
    );
  });

  it('shows the too many attempts sentence for a 429 on send', async () => {
    sendMock.mockResolvedValue({ error: { status: 429, message: 'slow down' } } as never);
    renderLogin();

    await enterEmail('friend@example.com');

    expect(await screen.findByText('Too many attempts, try again later')).toBeTruthy();
  });

  it('clears the send error on the next attempt', async () => {
    sendMock.mockResolvedValueOnce({ error: { code: 'SERVER_ERROR' } } as never);
    renderLogin();

    await enterEmail('friend@example.com');
    expect(await screen.findByText('Something went wrong. Try again.')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    await waitFor(() => expect(screen.getByLabelText('Digit 1')).toBeTruthy());
    expect(screen.queryByText('Something went wrong. Try again.')).toBeNull();
  });

  it('verifies in order (send, verify, refetch, session) and goes home', async () => {
    const order: string[] = [];
    sendMock.mockImplementation(async () => {
      order.push('send');
      return { data: { success: true } } as never;
    });
    verifyMock.mockImplementation(async () => {
      order.push('verify');
      return { data: { user: { name: 'You' } } } as never;
    });
    getSessionMock.mockImplementation(async () => {
      order.push('session');
      return { data: { user: { name: 'You' } } } as never;
    });
    const { calls } = renderLogin();

    await reachCodeStep();
    pasteCode('123456');

    expect(await screen.findByText('Home page')).toBeTruthy();
    expect(verifyMock).toHaveBeenCalledWith('friend@example.com', '123456', undefined);
    expect(order).toEqual(['send', 'verify', 'session']);
    expect(calls).toEqual(['refetch']);
    expect(getSessionMock).toHaveBeenCalledTimes(1);
  });

  it('calls refetch between verify and the session read', async () => {
    const order: string[] = [];
    verifyMock.mockImplementation(async () => {
      order.push('verify');
      return { data: { user: { name: 'You' } } } as never;
    });
    getSessionMock.mockImplementation(async () => {
      order.push('session');
      return { data: { user: { name: 'You' } } } as never;
    });
    const refetch = vi.fn(async () => {
      order.push('refetch');
    });
    render(
      <AuthProvider value={{ status: 'guest', user: undefined, refetch }}>
        <MemoryRouter initialEntries={['/login']}>
          <Routes>
            <Route path="/login" element={<LoginPage />} />
            <Route path="/" element={<div>Home page</div>} />
          </Routes>
        </MemoryRouter>
      </AuthProvider>,
    );

    await reachCodeStep();
    pasteCode('123456');

    expect(await screen.findByText('Home page')).toBeTruthy();
    expect(order).toEqual(['verify', 'refetch', 'session']);
  });

  it('returns to the page the user came from after signing in', async () => {
    renderLogin({ from: '/chats/abc' });

    await reachCodeStep();
    pasteCode('123456');

    expect(await screen.findByText('Chat abc')).toBeTruthy();
  });

  it('sends a nameless user to the name step and carries the page to return to', async () => {
    getSessionMock.mockResolvedValue({ data: { user: { name: '   ' } } } as never);
    renderLogin({ from: '/chats/abc' });

    await reachCodeStep();
    pasteCode('123456');

    expect(await screen.findByText(/Name step/)).toBeTruthy();
    expect(screen.getByText(/Name step/).textContent).toBe('Name step {"next":"/chats/abc"}');
  });

  it('sends a nameless user to the name step with no state when there is no origin page', async () => {
    getSessionMock.mockResolvedValue({ data: { user: { name: '' } } } as never);
    renderLogin();

    await reachCodeStep();
    pasteCode('123456');

    expect((await screen.findByText(/Name step/)).textContent).toBe('Name step null');
  });

  it('verifies from the Continue button once six digits are typed', async () => {
    renderLogin();

    await reachCodeStep();
    pasteCode('12345 ');
    // A short code is not complete: nothing is sent until it has six digits.
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(verifyMock).not.toHaveBeenCalled();

    pasteCode('654321');
    expect(await screen.findByText('Home page')).toBeTruthy();
    expect(verifyMock).toHaveBeenCalledWith('friend@example.com', '654321', undefined);
  });

  it('shows Wrong code, clears the digits and stays on the code step', async () => {
    verifyMock.mockResolvedValue({ error: { code: 'INVALID_OTP', message: 'invalid' } } as never);
    const { refetch } = renderLogin();

    await reachCodeStep();
    pasteCode('000000');

    expect(await screen.findByText('Wrong code')).toBeTruthy();
    expect(digits()).toBe('');
    expect(screen.getByLabelText('Digit 1').getAttribute('aria-invalid')).toBe('true');
    expect(refetch).not.toHaveBeenCalled();
    expect(getSessionMock).not.toHaveBeenCalled();
    expect(screen.queryByText('Home page')).toBeNull();
    expect((screen.getByRole('button', { name: 'Continue' }) as HTMLButtonElement).disabled).toBe(
      false,
    );
  });

  it('shows Wrong code for an expired code', async () => {
    verifyMock.mockResolvedValue({ error: { code: 'OTP_EXPIRED' } } as never);
    renderLogin();

    await reachCodeStep();
    pasteCode('000000');

    expect(await screen.findByText('Wrong code')).toBeTruthy();
  });

  it('shows the too many attempts sentence and the fixed fallback for other verify errors', async () => {
    verifyMock.mockResolvedValueOnce({ error: { code: 'TOO_MANY_ATTEMPTS' } } as never);
    verifyMock.mockResolvedValueOnce({ error: { code: 'SERVER_ERROR', message: 'raw' } } as never);
    renderLogin();

    await reachCodeStep();
    pasteCode('000000');
    expect(await screen.findByText('Too many attempts, try again later')).toBeTruthy();

    pasteCode('111111');
    expect(await screen.findByText('Something went wrong. Try again.')).toBeTruthy();
    expect(screen.queryByText('raw')).toBeNull();
  });

  it('disables the code step controls while a code is being verified', async () => {
    let finish: (value: never) => void = () => {};
    verifyMock.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve as (value: never) => void;
        }),
    );
    renderLogin();

    await reachCodeStep();
    pasteCode('123456');

    await waitFor(() =>
      expect((screen.getByRole('button', { name: 'Continue' }) as HTMLButtonElement).disabled).toBe(
        true,
      ),
    );
    expect((screen.getByLabelText('Digit 1') as HTMLInputElement).disabled).toBe(true);
    expect(verifyMock).toHaveBeenCalledTimes(1);

    // A second tap while busy sends nothing.
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(verifyMock).toHaveBeenCalledTimes(1);

    await act(async () => {
      finish({ error: { code: 'INVALID_OTP' } } as never);
    });
    expect(await screen.findByText('Wrong code')).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Continue' }) as HTMLButtonElement).disabled).toBe(
      false,
    );
  });

  it('goes back to the email step with the error cleared', async () => {
    verifyMock.mockResolvedValue({ error: { code: 'INVALID_OTP' } } as never);
    renderLogin();

    await reachCodeStep();
    pasteCode('000000');
    expect(await screen.findByText('Wrong code')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Use a different email' }));

    expect(screen.getByLabelText('Email')).toBeTruthy();
    expect((screen.getByLabelText('Email') as HTMLInputElement).value).toBe('friend@example.com');
    expect(screen.queryByText('Wrong code')).toBeNull();
    expect(screen.getByText(EMAIL_HINT)).toBeTruthy();
  });

  it('counts the resend timer down each second and then offers Resend code', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    renderLogin();

    await reachCodeStep();
    expect(screen.getByText('Resend in 30s')).toBeTruthy();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000);
    });
    expect(screen.getByText('Resend in 29s')).toBeTruthy();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(3_000);
    });
    expect(screen.getByText('Resend in 26s')).toBeTruthy();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(26_000);
    });
    expect(screen.queryByText(/Resend in/)).toBeNull();
    expect(screen.getByRole('button', { name: 'Resend code' })).toBeTruthy();
  });

  it('resends the code, clears the digits and restarts the timer', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    renderLogin();

    await reachCodeStep();
    pasteCode('12345 ');
    expect(digits()).toBe('12345');
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });
    expect(sendMock).toHaveBeenCalledTimes(1);

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Resend code' }));
    });

    await waitFor(() => expect(sendMock).toHaveBeenCalledTimes(2));
    expect(sendMock).toHaveBeenLastCalledWith('friend@example.com', undefined);
    expect(await screen.findByText('Resend in 30s')).toBeTruthy();
    expect(digits()).toBe('');
    expect(verifyMock).not.toHaveBeenCalled();
  });

  it('keeps the timer stopped and shows the error when a resend fails', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    renderLogin();

    await reachCodeStep();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });
    sendMock.mockResolvedValueOnce({ error: { code: 'SERVER_ERROR' } } as never);

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Resend code' }));
    });

    expect(await screen.findByText('Something went wrong. Try again.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Resend code' })).toBeTruthy();
    expect(screen.queryByText(/Resend in/)).toBeNull();
  });

  it('stops the timer when the page unmounts', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    renderLogin();

    await reachCodeStep();
    cleanup();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000);
    });

    expect(consoleError).not.toHaveBeenCalled();
    consoleError.mockRestore();
  });
});
