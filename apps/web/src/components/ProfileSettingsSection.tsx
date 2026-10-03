import { useEffect, useState } from 'react';
import { ApiError, claimHandle, checkHandle } from '@/lib/api';
import { useAuth } from '@/auth/AuthProvider';
import { copyText } from '@/lib/clipboard';

/** Settings → Profile: name, handle (with live check), share link. */
export function ProfileSettingsSection() {
  const auth = useAuth();
  const [handle, setHandle] = useState(auth.user?.handle ?? '');
  const [typed, setTyped] = useState(false);
  const [check, setCheck] = useState<
    { state: 'idle' } | { state: 'done'; available: boolean; reason?: string | undefined }
  >({ state: 'idle' });
  const [error, setError] = useState<string | undefined>(undefined);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  const trimmed = handle.trim();
  const current = auth.user?.handle ?? '';
  const unchanged = current !== '' && trimmed.toLowerCase() === current.toLowerCase();

  // Fill the input when the handle arrives after `getMe()` — but only while
  // the user has not started typing, so typed text is never overwritten.
  if (!typed && handle === '' && current !== '') {
    setHandle(current);
  }

  // Debounced live availability for a changed handle. The effect only
  // schedules the check (the lint rule flags synchronous setState inside
  // effects); the timeout callback applies the result once.
  useEffect(() => {
    if (trimmed === '' || unchanged) {
      return;
    }
    let active = true;
    const value = trimmed;
    const pending = setTimeout(() => {
      void checkHandle(value).then(
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
  }, [trimmed, current, unchanged]);

  const save = async (): Promise<void> => {
    if (trimmed === '') {
      setError('Choose a username');
      return;
    }
    setBusy(true);
    setError(undefined);
    setSaved(false);
    try {
      await claimHandle(trimmed);
      await auth.refetch();
      setSaved(true);
    } catch (saveError) {
      setError(friendlyError(saveError));
    } finally {
      setBusy(false);
    }
  };

  const shareUrl =
    typeof window === 'undefined' || (auth.user?.handle ?? null) === null
      ? null
      : `${window.location.origin}/@${encodeURIComponent(auth.user?.handle ?? '')}`;

  return (
    <section aria-label="Username" className="flex flex-col gap-2">
      <h2 className="text-[16px] font-semibold">Username</h2>
      <div className="rounded-xl border border-border bg-surface px-3 py-2.5">
        <label className="block text-[14px] font-medium" htmlFor="profile-handle">
          Your @username
        </label>
        <input
          id="profile-handle"
          value={handle}
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          maxLength={32}
          onChange={(event) => {
            setHandle(event.target.value);
            setTyped(true);
            setSaved(false);
          }}
          placeholder="ada_lovelace"
          className="mt-1 w-full rounded-lg border border-input bg-background px-3 py-2 text-[15px] outline-none focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-accent/40"
        />
        <div aria-live="polite" className="mt-1 min-h-[20px] text-[14px]">
          {check.state === 'done' &&
            (check.available ? (
              <span className="text-muted-foreground">@{trimmed} is available</span>
            ) : (
              <span className="text-danger">{reasonText(check.reason)}</span>
            ))}
        </div>
        {error !== undefined && (
          <p role="alert" className="mt-1 text-[14px] text-danger">
            {error}
          </p>
        )}
        {saved && <p className="mt-1 text-[14px] text-muted-foreground">Saved.</p>}
        <div className="mt-2 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => void save()}
            disabled={busy || unchanged}
            className="rounded-full bg-accent px-4 py-1.5 text-[14px] font-medium text-accent-foreground hover:bg-accent/90 disabled:opacity-60"
          >
            {busy ? 'Saving…' : 'Save username'}
          </button>
          {shareUrl !== null && (
            <button
              type="button"
              onClick={() => {
                void copyText(shareUrl).then(() => setCopied(true));
              }}
              className="rounded-full border border-border px-4 py-1.5 text-[14px] hover:bg-surface-raised"
            >
              {copied ? 'Copied' : 'Copy share link'}
            </button>
          )}
        </div>
      </div>
    </section>
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
      case 'handle_change_too_soon': {
        // The server sends the next-change date as `nextChangeAt` in the
        // 409 error body; the message is only the fallback.
        const next = error.detail.nextChangeAt;
        if (typeof next === 'string' && next !== '') {
          const date = new Date(next);
          if (!Number.isNaN(date.getTime())) {
            return `Next change possible on ${date.toLocaleDateString()}`;
          }
        }
        return error.message;
      }
      case 'rate_limited':
        return 'Too many tries — wait a little and try again.';
      default:
        return error.message;
    }
  }
  return 'Could not save your username. Try again.';
}
