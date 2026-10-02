import { useEffect, useState } from 'react';
import { Navigate } from 'react-router';
import { AuthFlow } from '@/components/auth/AuthFlow';
import { ApiError, getSetupStatus, postSetup } from '@/lib/api';

function isEmailValid(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
}

/**
 * First-run setup (T-0161): the Resend API key, the sender address and the
 * admin email. On success the server has already emailed a sign-in code to
 * the admin, so the page goes straight to the code step — carrying the
 * invite code in memory only (never in storage, URL or logs) and sending
 * it with the sign-up request itself. The admin only types the 6-digit
 * code from their inbox.
 */
export function SetupPage() {
  const [status, setStatus] = useState<'checking' | 'ready' | 'done'>('checking');
  const [resendApiKey, setResendApiKey] = useState('');
  const [from, setFrom] = useState('');
  const [adminEmail, setAdminEmail] = useState('');
  const [inviteCode, setInviteCode] = useState<string | undefined>(undefined);
  const [error, setError] = useState<string | undefined>(undefined);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    getSetupStatus()
      .then((result) => {
        if (active) {
          setStatus(result.needsSetup ? 'ready' : 'done');
        }
      })
      .catch(() => {
        if (active) {
          setStatus('ready');
        }
      });
    return () => {
      active = false;
    };
  }, []);

  if (status === 'checking') {
    return (
      <div className="chat-background flex min-h-dvh items-center justify-center text-[15px] text-muted-foreground">
        Checking server setup…
      </div>
    );
  }

  if (status === 'done') {
    return <Navigate to="/login" replace />;
  }

  if (inviteCode !== undefined) {
    return (
      <AuthFlow
        key={adminEmail}
        inviteCode={inviteCode}
        heading="Check your inbox"
        subheading={`Enter the 6-digit code we sent to ${adminEmail.trim()}`}
        initialEmail={adminEmail.trim()}
        initialStep="code"
      />
    );
  }

  const submit = (event: React.FormEvent): void => {
    event.preventDefault();
    if (resendApiKey.trim() === '') {
      setError('Enter your Resend API key');
      return;
    }
    if (from.trim() === '') {
      setError('Enter the sender address');
      return;
    }
    if (!isEmailValid(adminEmail)) {
      setError('Enter a valid admin email address');
      return;
    }
    setBusy(true);
    setError(undefined);
    postSetup({
      resendApiKey: resendApiKey.trim(),
      from: from.trim(),
      adminEmail: adminEmail.trim(),
    })
      .then((result) => {
        setBusy(false);
        setInviteCode(result.inviteCode);
      })
      .catch((requestError: unknown) => {
        setBusy(false);
        if (requestError instanceof ApiError && requestError.code === 'mail_send_failed') {
          setError(
            'The test email could not be sent. Check the Resend key and the sender address.',
          );
          return;
        }
        if (requestError instanceof ApiError && requestError.code === 'rate_limited') {
          setError('Too many attempts, try again later');
          return;
        }
        setError('Something went wrong. Try again.');
      });
  };

  return (
    <div className="chat-background flex min-h-dvh items-center justify-center p-4">
      <div className="w-full max-w-sm rounded-2xl bg-background p-6 shadow-xl">
        <img src="/icons/icon-192.png" alt="" width={72} height={72} className="mx-auto mb-3" />
        <h1 className="text-center text-[24px] leading-8 font-semibold">Set up your server</h1>
        <p className="mt-1 text-center text-[15px] text-muted-foreground">
          Connect email so people can sign in with a code, and create the first admin account.
        </p>

        <form onSubmit={submit} className="mt-6 flex flex-col gap-3">
          <label className="text-[14px] font-medium" htmlFor="setup-resend-key">
            Resend API key
          </label>
          <input
            id="setup-resend-key"
            type="password"
            autoComplete="off"
            value={resendApiKey}
            onChange={(event) => setResendApiKey(event.target.value)}
            placeholder="re_…"
            className="rounded-lg border border-input bg-background px-3 py-2 text-[15px] outline-none focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-accent/40"
          />
          <p className="-mt-1 text-[13px] text-muted-foreground">
            Get one at resend.com/api-keys. The sending domain must be verified in Resend.
          </p>

          <label className="text-[14px] font-medium" htmlFor="setup-from">
            Sender address
          </label>
          <input
            id="setup-from"
            type="text"
            autoComplete="email"
            value={from}
            onChange={(event) => setFrom(event.target.value)}
            placeholder="Zilar <no-reply@example.com>"
            className="rounded-lg border border-input bg-background px-3 py-2 text-[15px] outline-none focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-accent/40"
          />

          <label className="text-[14px] font-medium" htmlFor="setup-admin-email">
            Admin email
          </label>
          <input
            id="setup-admin-email"
            type="email"
            autoComplete="email"
            value={adminEmail}
            onChange={(event) => setAdminEmail(event.target.value)}
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
            {busy ? 'Sending test email…' : 'Continue'}
          </button>
        </form>
      </div>
    </div>
  );
}
