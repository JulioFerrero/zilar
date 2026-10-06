import { useState } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { useAuth } from '@/auth/AuthProvider';
import { Button } from '@/components/ui/button';
import { TextInput } from '@/components/ui/text-input';
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
        <div className="mt-6">
          <TextInput
            id="auth-name"
            label="Name"
            value={name}
            autoFocus
            maxLength={64}
            onChange={(event) => setName(event.target.value)}
            placeholder="Your name"
          />
        </div>
        {error !== undefined && (
          <p role="alert" className="mt-2 text-[14px] text-danger">
            {error}
          </p>
        )}
        <Button type="submit" disabled={busy} size="lg" className="mt-4 w-full">
          Continue
        </Button>
      </form>
    </div>
  );
}
