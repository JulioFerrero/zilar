import { useEffect, useState } from 'react';
import { Navigate } from 'react-router';
import { AuthFlow } from '@/components/auth/AuthFlow';
import { Button } from '@/components/ui/button';
import { TextInput } from '@/components/ui/text-input';
import { ApiError, getSetupStatus, postSetup } from '@/lib/api';

function isEmailValid(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
}

const DEFAULT_FROM = 'Zilar <onboarding@resend.dev>';

/**
 * First-run setup (T-0161) in three steps. Step 1 asks for the admin
 * email; step 2 asks for the Resend key and the sender address and sends
 * all three values to the server in ONE request (the server verifies by
 * emailing the sign-in code with the new key and stores the key only if
 * that send worked). Step 3 is the normal sign-in code step with the
 * email prefilled — carrying the invite code in memory only (never in
 * storage, URL or logs) and sending it with the sign-up request itself.
 * The admin only types the 6-digit code from their inbox.
 */
export function SetupPage() {
  const [status, setStatus] = useState<'checking' | 'ready' | 'done' | 'statusFailed'>('checking');
  const [step, setStep] = useState<1 | 2>(1);
  const [adminEmail, setAdminEmail] = useState('');
  const [resendApiKey, setResendApiKey] = useState('');
  const [from, setFrom] = useState(DEFAULT_FROM);
  const [inviteCode, setInviteCode] = useState<string | undefined>(undefined);
  const [error, setError] = useState<string | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [checkNonce, setCheckNonce] = useState(0);

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
          setStatus('statusFailed');
        }
      });
    return () => {
      active = false;
    };
  }, [checkNonce]);

  if (status === 'checking') {
    return (
      <div className="chat-background flex min-h-dvh items-center justify-center text-[15px] text-muted-foreground">
        Checking server setup…
      </div>
    );
  }

  if (status === 'statusFailed') {
    return (
      <div className="chat-background flex min-h-dvh items-center justify-center p-4">
        <div className="w-full max-w-sm rounded-2xl bg-background p-6 text-center shadow-xl">
          <h1 className="text-[24px] leading-8 font-semibold">Could not reach the server</h1>
          <p className="mt-2 text-[15px] text-muted-foreground">
            The setup status could not be loaded. Check your connection and try again.
          </p>
          <Button
            type="button"
            onClick={() => {
              setStatus('checking');
              setCheckNonce((value) => value + 1);
            }}
            size="lg"
            className="mt-5"
          >
            Retry
          </Button>
        </div>
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

  const submitEmail = (event: React.FormEvent): void => {
    event.preventDefault();
    if (!isEmailValid(adminEmail)) {
      setError('Enter a valid admin email address');
      return;
    }
    setError(undefined);
    setStep(2);
  };

  const submitSetup = (event: React.FormEvent): void => {
    event.preventDefault();
    if (resendApiKey.trim() === '') {
      setError('Enter your Resend API key');
      return;
    }
    if (from.trim() === '') {
      setError('Enter the sender address');
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
          {step === 1
            ? 'Create the first admin account.'
            : 'Connect email so people can sign in with a code.'}
        </p>

        {step === 1 ? (
          <form onSubmit={submitEmail} className="mt-6 flex flex-col gap-3">
            <TextInput
              id="setup-admin-email"
              label="Admin email"
              type="email"
              autoComplete="email"
              value={adminEmail}
              onChange={(event) => setAdminEmail(event.target.value)}
              placeholder="you@example.com"
            />
            {error !== undefined && (
              <p role="alert" className="text-[14px] text-danger">
                {error}
              </p>
            )}
            <Button type="submit" size="lg" className="mt-1">
              Next
            </Button>
          </form>
        ) : (
          <form onSubmit={submitSetup} className="mt-6 flex flex-col gap-3">
            <TextInput
              id="setup-resend-key"
              label="Resend API key"
              hint="Create one at resend.com/api-keys."
              type="password"
              autoComplete="off"
              value={resendApiKey}
              onChange={(event) => setResendApiKey(event.target.value)}
              placeholder="re_…"
            />

            <TextInput
              id="setup-from"
              label="From address"
              hint="This address works for testing and sends only to the email of your own Resend account; once your domain is verified in Resend, use an address on that domain."
              type="text"
              autoComplete="email"
              value={from}
              onChange={(event) => setFrom(event.target.value)}
            />

            {error !== undefined && (
              <p role="alert" className="text-[14px] text-danger">
                {error}
              </p>
            )}
            <div className="mt-1 flex items-center gap-3">
              <Button
                type="button"
                variant="outline"
                size="lg"
                disabled={busy}
                onClick={() => {
                  setStep(1);
                  setError(undefined);
                }}
              >
                Back
              </Button>
              <Button type="submit" disabled={busy} size="lg" className="flex-1">
                {busy ? 'Sending your code…' : 'Send my code'}
              </Button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
