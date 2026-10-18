import { useAuth } from '@/auth/AuthProvider';
import { Button } from '@/components/ui/button';
import { TextInput } from '@/components/ui/text-input';
import { authClient, sendSignInCode, verifySignInCode } from '@/lib/auth';
import { useAction } from '@/lib/effect/use-action';
import { useQuery } from '@/lib/effect/use-query';
import { cn } from '@/lib/utils';
import { parseInviteCode } from '@zilar/chat-core';
import { Effect } from 'effect';
import { useState, useEffect, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router';

function InviteCodeField({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <TextInput
      id="auth-invite-code"
      label="Invite code"
      value={value}
      autoComplete="off"
      autoCorrect="off"
      autoCapitalize="none"
      spellCheck={false}
      placeholder="Paste your invite code or link"
      onChange={(event) => onChange(parseInviteCode(event.target.value))}
    />
  );
}

const RESEND_SECONDS = 30;
const RESEND_TICK_MS = 1000;

interface AuthErrorLike {
  code?: string;
  message?: string;
  status?: number;
}

function errorMessageFor(error: AuthErrorLike | null | undefined): string {
  const code = error?.code ?? '';
  if (code === 'invite_required') {
    return 'This email has no account yet. Enter your invite code to sign up.';
  }
  if (code === 'invite_invalid') {
    return 'This invite code is invalid, expired or already used.';
  }
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

const LENGTH = 6;

function OtpInput({
  value,
  onChange,
  onComplete,
  disabled,
  invalid,
  label = 'Verification code',
}: {
  value: string;
  onChange: (value: string) => void;
  onComplete?: (value: string) => void;
  disabled?: boolean;
  invalid?: boolean;
  label?: string;
}) {
  const refs = useRef<Array<HTMLInputElement | null>>([]);
  const digits = value.padEnd(LENGTH, ' ').slice(0, LENGTH).split('');

  useEffect(() => {
    refs.current[0]?.focus();
  }, []);

  const commit = (next: string): void => {
    const trimmed = next.replace(/\s+$/, '');
    onChange(trimmed);
    if (trimmed.length === LENGTH) {
      onComplete?.(trimmed);
    }
  };

  const setAt = (index: number, digit: string): string => {
    const next = digits
      .map((current, position) => (position === index ? digit : current))
      .join('')
      .slice(0, LENGTH);
    return next;
  };

  const handleChange = (index: number, raw: string): void => {
    const digit = raw.replace(/\D/g, '').slice(-1);
    commit(setAt(index, digit === '' ? ' ' : digit));
    if (digit !== '') {
      refs.current[index + 1]?.focus();
    }
  };

  const handlePaste = (event: React.ClipboardEvent): void => {
    const pasted = event.clipboardData.getData('text').replace(/\D/g, '').slice(0, LENGTH);
    if (pasted === '') {
      return;
    }
    event.preventDefault();
    commit(pasted.padEnd(LENGTH, ' '));
    refs.current[Math.min(pasted.length, LENGTH - 1)]?.focus();
  };

  const handleKeyDown = (index: number, event: React.KeyboardEvent): void => {
    if (event.key === 'Backspace' && digits[index]?.trim() === '') {
      event.preventDefault();
      commit(setAt(index - 1, ' '));
      refs.current[index - 1]?.focus();
    }
    if (event.key === 'ArrowLeft') {
      refs.current[index - 1]?.focus();
    }
    if (event.key === 'ArrowRight') {
      refs.current[index + 1]?.focus();
    }
  };

  return (
    <div role="group" aria-label={label} className="flex justify-center gap-2">
      {digits.map((digit, index) => (
        <input
          // Position is the stable identity of each box.
          key={index}
          ref={(element) => {
            refs.current[index] = element;
          }}
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={1}
          value={digit.trim()}
          disabled={disabled}
          aria-label={`Digit ${index + 1}`}
          aria-invalid={invalid === true}
          onChange={(event) => handleChange(index, event.target.value)}
          onPaste={handlePaste}
          onKeyDown={(event) => handleKeyDown(index, event)}
          className={cn(
            'size-11 rounded-lg border bg-background text-center text-[20px] font-semibold outline-none',
            'focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-accent/40',
            invalid === true ? 'border-danger' : 'border-input',
            disabled === true && 'opacity-50',
          )}
        />
      ))}
    </div>
  );
}

export function AuthFlow({
  inviteCode: inviteCodeProp,
  heading,
  subheading,
  initialEmail,
  initialStep,
}: {
  inviteCode?: string | undefined;
  heading: string;
  subheading?: string;
  initialEmail?: string | undefined;
  initialStep?: 'email' | 'code' | undefined;
}) {
  const navigate = useNavigate();
  const location = useLocation();
  const auth = useAuth();
  const [step, setStep] = useState<'email' | 'code'>(initialStep ?? 'email');
  const [email, setEmail] = useState(initialEmail ?? '');
  const [code, setCode] = useState('');
  const [inviteCode, setInviteCode] = useState(inviteCodeProp ?? '');
  const [inviteStep, setInviteStep] = useState(false);
  const [inviteHint, setInviteHint] = useState<string | undefined>(undefined);
  const [error, setError] = useState<string | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [secondsLeft, setSecondsLeft] = useState(0);

  const requestInvite = (): string | undefined => {
    const raw = inviteStep ? inviteCode : initialStep === 'code' ? inviteCodeProp : '';
    const trimmed = (raw ?? '').trim();
    return trimmed === '' ? undefined : trimmed;
  };

  // One second per value of `secondsLeft`: each tick (or a new 30s) restarts the
  // wait, and an unmount interrupts it.
  useQuery(
    () =>
      secondsLeft <= 0
        ? Effect.void
        : Effect.sleep(RESEND_TICK_MS).pipe(
            Effect.andThen(Effect.sync(() => setSecondsLeft((value) => Math.max(0, value - 1)))),
          ),
    [secondsLeft],
  );

  const [, requestCode] = useAction((address: string) =>
    Effect.gen(function* () {
      yield* Effect.sync(() => {
        setBusy(true);
        setError(undefined);
      });
      const result = yield* Effect.promise(() => sendSignInCode(address, requestInvite()));
      yield* Effect.sync(() => setBusy(false));
      if (result.error) {
        yield* Effect.sync(() => {
          const authError = result.error as AuthErrorLike;
          if (authError.code === 'invite_required') {
            setInviteStep(true);
            setInviteHint(errorMessageFor(authError));
            return;
          }
          setError(errorMessageFor(authError));
        });
        return;
      }
      yield* Effect.sync(() => {
        setCode('');
        setStep('code');
        setSecondsLeft(RESEND_SECONDS);
      });
    }),
  );

  const changeEmail = (value: string): void => {
    setEmail(value);
    setInviteStep(false);
    setError(undefined);
    setInviteHint(undefined);
  };

  const submitEmail = (event: React.FormEvent): void => {
    event.preventDefault();
    if (!isEmailValid(email)) {
      setError('Enter a valid email address');
      return;
    }
    requestCode(email.trim());
  };

  const [, verifyCode] = useAction((attempt: { address: string; value: string }) =>
    Effect.gen(function* () {
      yield* Effect.sync(() => {
        setBusy(true);
        setError(undefined);
      });
      const result = yield* Effect.promise(() =>
        verifySignInCode(attempt.address, attempt.value, requestInvite()),
      );
      yield* Effect.sync(() => setBusy(false));
      if (result.error) {
        yield* Effect.sync(() => {
          setError(errorMessageFor(result.error as AuthErrorLike));
          setCode('');
        });
        return;
      }

      yield* Effect.promise(() => auth.refetch());
      const session = yield* Effect.promise(() => authClient.getSession());
      const name = session.data?.user.name ?? '';
      const from = (location.state as { from?: string } | null)?.from;
      yield* Effect.sync(() =>
        navigate(
          name.trim() === '' ? '/welcome/name' : (from ?? '/'),
          name.trim() === ''
            ? { replace: true, state: from === undefined ? undefined : { next: from } }
            : { replace: true },
        ),
      );
    }),
  );

  const verify = (value: string): void => {
    if (busy || value.length !== 6) {
      return;
    }
    verifyCode({ address: email.trim(), value });
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
            <TextInput
              id="auth-email"
              label="Email"
              type="email"
              autoComplete="email"
              autoFocus
              value={email}
              onChange={(event) => changeEmail(event.target.value)}
              placeholder="you@example.com"
            />
            {inviteStep === false && error !== undefined && (
              <p role="alert" className="text-[14px] text-danger">
                {error}
              </p>
            )}
            {inviteStep && inviteHint !== undefined && (
              <p className="text-[14px] text-muted-foreground">{inviteHint}</p>
            )}
            {inviteStep && <InviteCodeField value={inviteCode} onChange={setInviteCode} />}
            {inviteStep && error !== undefined && (
              <p role="alert" className="text-[14px] text-danger">
                {error}
              </p>
            )}
            <Button type="submit" disabled={busy} size="lg" className="mt-1">
              Continue
            </Button>
          </form>
        ) : (
          <div className="mt-6 flex flex-col items-center gap-4">
            <p className="text-center text-[15px] text-muted-foreground">
              Enter the 6-digit code we sent to <span className="text-foreground">{email}</span>
            </p>
            <OtpInput
              value={code}
              onChange={setCode}
              onComplete={verify}
              disabled={busy}
              invalid={error !== undefined}
            />
            {error !== undefined && (
              <p role="alert" className="text-[14px] text-danger">
                {error}
              </p>
            )}
            <div className="flex items-center gap-3">
              <Button type="button" disabled={busy} onClick={() => verify(code)} size="lg">
                Continue
              </Button>
              {secondsLeft > 0 ? (
                <span className="text-[14px] text-muted-foreground">Resend in {secondsLeft}s</span>
              ) : (
                <Button
                  type="button"
                  variant="link"
                  size="sm"
                  disabled={busy}
                  onClick={() => requestCode(email.trim())}
                  className="h-auto px-0 text-[14px] text-accent"
                >
                  Resend code
                </Button>
              )}
            </div>
            <Button
              type="button"
              variant="link"
              size="sm"
              onClick={() => {
                setStep('email');
                setError(undefined);
              }}
              className="h-auto px-0 text-[14px] text-muted-foreground"
            >
              Use a different email
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
