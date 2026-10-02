import { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { OtpInput } from './OtpInput';
import { useAuth } from '@/auth/AuthProvider';
import { authClient, sendSignInCode, verifySignInCode } from '@/lib/auth';

const RESEND_SECONDS = 30;

interface AuthErrorLike {
  code?: string;
  message?: string;
  status?: number;
}

function errorMessageFor(error: AuthErrorLike | null | undefined): string {
  const code = error?.code ?? '';
  if (code === 'TOO_MANY_ATTEMPTS' || error?.status === 429) {
    return 'Too many attempts, try again later';
  }
  if (code === 'INVALID_OTP' || code === 'OTP_EXPIRED') {
    return 'Wrong code';
  }
  return 'Something went wrong. Try again.';
}

function isEmailValid(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
}

/**
 * Shared email → code → session flow for both the invite and the login pages.
 * On an invite, every auth request carries the invite code header.
 */
export function AuthFlow({
  inviteCode,
  heading,
  subheading,
}: {
  inviteCode?: string | undefined;
  heading: string;
  subheading?: string;
}) {
  const navigate = useNavigate();
  const location = useLocation();
  const auth = useAuth();
  const [step, setStep] = useState<'email' | 'code'>('email');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [secondsLeft, setSecondsLeft] = useState(0);

  useEffect(() => {
    if (secondsLeft <= 0) {
      return;
    }
    const timer = setInterval(() => {
      setSecondsLeft((value) => Math.max(0, value - 1));
    }, 1000);
    return () => clearInterval(timer);
  }, [secondsLeft]);

  const requestCode = async (): Promise<void> => {
    setBusy(true);
    setError(undefined);
    const result = await sendSignInCode(email.trim(), inviteCode);
    setBusy(false);
    if (result.error) {
      setError(errorMessageFor(result.error as AuthErrorLike));
      return;
    }
    setCode('');
    setStep('code');
    setSecondsLeft(RESEND_SECONDS);
  };

  const submitEmail = (event: React.FormEvent): void => {
    event.preventDefault();
    if (!isEmailValid(email)) {
      setError('Enter a valid email address');
      return;
    }
    void requestCode();
  };

  const verify = async (value: string): Promise<void> => {
    if (busy || value.length !== 6) {
      return;
    }
    setBusy(true);
    setError(undefined);
    const result = await verifySignInCode(email.trim(), value, inviteCode);
    setBusy(false);
    if (result.error) {
      setError(errorMessageFor(result.error as AuthErrorLike));
      setCode('');
      return;
    }

    await auth.refetch();
    const session = await authClient.getSession();
    const name = session.data?.user.name ?? '';
    const from = (location.state as { from?: string } | null)?.from;
    // A nameless user picks a name first, then continues to `from` — the
    // name step reads the same `next` state JoinPage writes.
    navigate(
      name.trim() === '' ? '/welcome/name' : (from ?? '/'),
      name.trim() === ''
        ? { replace: true, state: from === undefined ? undefined : { next: from } }
        : { replace: true },
    );
  };

  return (
    <div className="chat-background flex min-h-dvh items-center justify-center p-4">
      <div className="w-full max-w-sm rounded-2xl bg-background p-6 shadow-xl">
        <img src="/icons/icon-192.png" alt="" width={72} height={72} className="mx-auto mb-3" />
        <h1 className="text-center text-[24px] leading-8 font-semibold">{heading}</h1>
        {subheading !== undefined && (
          <p className="mt-1 text-center text-[15px] text-muted-foreground">{subheading}</p>
        )}

        {step === 'email' ? (
          <form onSubmit={submitEmail} className="mt-6 flex flex-col gap-3">
            <label className="text-[14px] font-medium" htmlFor="auth-email">
              Email
            </label>
            <input
              id="auth-email"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="you@example.com"
              className="rounded-lg border border-input bg-background px-3 py-2 text-[15px] outline-none focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-accent/40"
            />
            {error !== undefined && (
              <p role="alert" className="text-[14px] text-danger">
                {error}
              </p>
            )}
            <button
              type="submit"
              disabled={busy}
              className="mt-1 rounded-full bg-accent px-4 py-2.5 text-[15px] font-medium text-accent-foreground hover:bg-accent/90 disabled:opacity-60"
            >
              Continue
            </button>
          </form>
        ) : (
          <div className="mt-6 flex flex-col items-center gap-4">
            <p className="text-center text-[15px] text-muted-foreground">
              Enter the 6-digit code we sent to <span className="text-foreground">{email}</span>
            </p>
            <OtpInput
              value={code}
              onChange={setCode}
              onComplete={(value) => void verify(value)}
              disabled={busy}
              invalid={error !== undefined}
            />
            {error !== undefined && (
              <p role="alert" className="text-[14px] text-danger">
                {error}
              </p>
            )}
            <div className="flex items-center gap-3">
              <button
                type="button"
                disabled={busy}
                onClick={() => void verify(code)}
                className="rounded-full bg-accent px-5 py-2 text-[15px] font-medium text-accent-foreground hover:bg-accent/90 disabled:opacity-60"
              >
                Continue
              </button>
              {secondsLeft > 0 ? (
                <span className="text-[14px] text-muted-foreground">Resend in {secondsLeft}s</span>
              ) : (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void requestCode()}
                  className="text-[14px] text-accent hover:underline"
                >
                  Resend code
                </button>
              )}
            </div>
            <button
              type="button"
              onClick={() => {
                setStep('email');
                setError(undefined);
              }}
              className="text-[14px] text-muted-foreground hover:underline"
            >
              Use a different email
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
