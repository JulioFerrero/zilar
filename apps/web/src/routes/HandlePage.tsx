import { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { useAuth } from '@/auth/AuthProvider';
import { Button } from '@/components/ui/button';
import { ApiError } from '@/lib/api';
import { checkHandle, claimHandle, suggestHandleFor } from '@/lib/handles';
import { dismissHandleGate } from '@/lib/handleGate';

/** Onboarding step after the name step: pick a unique `@username`. */
export function HandlePage() {
  const navigate = useNavigate();
  const location = useLocation();
  const auth = useAuth();
  // The suggestion fills when the user arrives (name/email may resolve
  // after mount) while the input is untouched; typing wins forever after.
  const [handle, setHandle] = useState(() =>
    auth.user === undefined ? '' : suggestHandleFor(auth.user.name, auth.user.email),
  );
  const [typed, setTyped] = useState(false);
  const serverUser = auth.user;
  if (!typed && handle === '' && serverUser !== undefined) {
    const suggestion = suggestHandleFor(serverUser.name, serverUser.email);
    if (suggestion !== '') {
      setHandle(suggestion);
    }
  }
  const [check, setCheck] = useState<
    | { state: 'idle' }
    | { state: 'checking' }
    | { state: 'done'; available: boolean; reason?: string | undefined }
  >({ state: 'idle' });
  const [error, setError] = useState<string | undefined>(undefined);
  const [busy, setBusy] = useState(false);

  const trimmed = handle.trim();

  // Debounced live availability for the typed handle. The effect only
  // schedules the check (the lint rule flags synchronous setState inside
  // effects); the timeout callback applies the result once.
  useEffect(() => {
    if (trimmed === '') {
      return;
    }
    let active = true;
    const pending = setTimeout(() => {
      // The pending state paints immediately; the settled state lands in
      // the promise below, never synchronously in this effect.
      void checkHandle(trimmed).then(
        (result) => {
          if (active) {
            setCheck({ state: 'done', available: result.available, reason: result.reason });
          }
        },
        (checkError: unknown) => {
          if (!active) {
            return;
          }
          if (checkError instanceof ApiError && checkError.code === 'rate_limited') {
            setCheck({ state: 'done', available: false, reason: 'rate_limited' });
            return;
          }
          setCheck({ state: 'idle' });
        },
      );
    }, 300);
    return () => {
      active = false;
      clearTimeout(pending);
    };
  }, [trimmed]);

  const next = (location.state as { next?: string } | null)?.next;

  const submit = async (event: React.FormEvent): Promise<void> => {
    event.preventDefault();
    if (trimmed === '') {
      setError('Choose a username');
      return;
    }
    setBusy(true);
    setError(undefined);
    try {
      await claimHandle(trimmed);
      await auth.refetch();
      navigate(next ?? '/', { replace: true });
    } catch (submitError) {
      setBusy(false);
      setError(friendlyError(submitError));
    }
  };

  const skip = (): void => {
    // "Skip for now" really skips: record the dismissal for this browser
    // session (kept separate from any claim), so the gate does not ask
    // again until the next session. New users in the onboarding flow still
    // reach this step via the name page's chain, not the gate.
    if (auth.user !== undefined) {
      dismissHandleGate(auth.user.id);
    }
    navigate(next ?? '/', { replace: true });
  };

  return (
    <div className="chat-background flex min-h-dvh items-center justify-center p-4">
      <form
        onSubmit={(event) => void submit(event)}
        className="w-full max-w-sm rounded-2xl bg-background p-6 shadow-xl"
      >
        <h1 className="text-center text-[24px] leading-8 font-semibold">Pick your username</h1>
        <p className="mt-1 text-center text-[15px] text-muted-foreground">
          Friends add you with it, like @ada. You can change it later.
        </p>
        <label className="mt-6 block text-[14px] font-medium" htmlFor="auth-handle">
          Username
        </label>
        <input
          id="auth-handle"
          value={handle}
          autoFocus
          maxLength={32}
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          onChange={(event) => {
            setHandle(event.target.value);
            setTyped(true);
          }}
          placeholder="ada_lovelace"
          className="mt-1 w-full rounded-lg border border-input bg-background px-3 py-2 text-[15px] outline-none focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-accent/40"
        />
        <div aria-live="polite" className="mt-2 min-h-[20px] text-[14px]">
          {check.state === 'done' &&
            (check.available ? (
              <span className="text-muted-foreground">@{trimmed} is available</span>
            ) : (
              <span className="text-danger">{reasonText(check.reason)}</span>
            ))}
        </div>
        {error !== undefined && (
          <p role="alert" className="mt-2 text-[14px] text-danger">
            {error}
          </p>
        )}
        <Button type="submit" disabled={busy} size="lg" className="mt-4 w-full">
          Continue
        </Button>
        <button
          type="button"
          onClick={skip}
          className="mt-2 w-full rounded-full px-4 py-2 text-[15px] text-muted-foreground hover:text-foreground"
        >
          Skip for now
        </button>
      </form>
    </div>
  );
}

function reasonText(reason: string | undefined): string {
  switch (reason) {
    case 'invalid':
      return 'Use 3–32 characters: letters, numbers and _, starting with a letter.';
    case 'reserved':
      return 'That username is reserved. Try another.';
    case 'rate_limited':
      return 'Too many checks — wait a little and try again.';
    default:
      return 'That username is taken. Try another.';
  }
}

function friendlyError(error: unknown): string {
  if (error instanceof ApiError) {
    switch (error.code) {
      case 'handle_invalid':
        return 'Use 3–32 characters: letters, numbers and _, starting with a letter.';
      case 'handle_reserved':
        return 'That username is reserved. Try another.';
      case 'handle_taken':
        return 'That username was just taken. Try another.';
      case 'handle_change_too_soon':
        return error.message;
      case 'rate_limited':
        return 'Too many tries — wait a little and try again.';
      default:
        return error.message;
    }
  }
  return 'Could not save your username. Try again.';
}
