import { useState } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { useAuth } from '@/auth/AuthProvider';
import { updateMe } from '@/lib/api';

export function NamePage() {
  const navigate = useNavigate();
  const location = useLocation();
  const auth = useAuth();
  const [name, setName] = useState(auth.user?.name ?? '');
  const [error, setError] = useState<string | undefined>(undefined);
  const [busy, setBusy] = useState(false);

  const submit = async (event: React.FormEvent): Promise<void> => {
    event.preventDefault();
    const trimmed = name.trim();
    if (trimmed.length === 0) {
      setError('Enter your name');
      return;
    }
    setBusy(true);
    setError(undefined);
    try {
      await updateMe(trimmed);
      await auth.refetch();
      // Callers (e.g. the join-by-link page) pass `next` to come back
      // after the name step; the default chains into the handle step.
      const next = (location.state as { next?: string } | null)?.next;
      navigate(next === undefined ? '/welcome/handle' : next, { replace: true });
    } catch {
      setBusy(false);
      setError('Could not save your name. Try again.');
    }
  };

  return (
    <div className="chat-background flex min-h-dvh items-center justify-center p-4">
      <form
        onSubmit={(event) => void submit(event)}
        className="w-full max-w-sm rounded-2xl bg-background p-6 shadow-xl"
      >
        <h1 className="text-center text-[24px] leading-8 font-semibold">
          What should we call you?
        </h1>
        <p className="mt-1 text-center text-[15px] text-muted-foreground">
          Your friends will see this name.
        </p>
        <label className="mt-6 block text-[14px] font-medium" htmlFor="auth-name">
          Name
        </label>
        <input
          id="auth-name"
          value={name}
          autoFocus
          maxLength={64}
          onChange={(event) => setName(event.target.value)}
          placeholder="Your name"
          className="mt-1 w-full rounded-lg border border-input bg-background px-3 py-2 text-[15px] outline-none focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-accent/40"
        />
        {error !== undefined && (
          <p role="alert" className="mt-2 text-[14px] text-danger">
            {error}
          </p>
        )}
        <button
          type="submit"
          disabled={busy}
          className="mt-4 w-full rounded-full bg-accent px-4 py-2.5 text-[15px] font-medium text-accent-foreground hover:bg-accent/90 disabled:opacity-60"
        >
          Continue
        </button>
      </form>
    </div>
  );
}
