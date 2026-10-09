import { Data, Effect } from 'effect';
import { AsyncResult } from 'effect/reactivity';
import { useState } from 'react';
import { Navigate } from 'react-router';
import { AuthFlow } from '@/components/auth/AuthFlow';
import { Button } from '@/components/ui/button';
import { TextInput } from '@/components/ui/text-input';
import { getSetupStatus, postSetup, type SetupResult } from '@/lib/api';
import { fromApi } from '@/lib/effect/api-effect';
import type { ApiFailure } from '@/lib/effect/errors';
import { failureOf, isWaiting, useAction } from '@/lib/effect/use-action';
import { useQuery } from '@/lib/effect/use-query';

function isEmailValid(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
}

const DEFAULT_FROM = 'Zilar <onboarding@resend.dev>';

class KeyMissing extends Data.TaggedError('KeyMissing') {}
class FromMissing extends Data.TaggedError('FromMissing') {}

type SetupFailure = KeyMissing | FromMissing | ApiFailure;

function setupErrorText(failure: SetupFailure): string {
  switch (failure._tag) {
    case 'KeyMissing':
      return 'Enter your Resend API key';
    case 'FromMissing':
      return 'Enter the sender address';
    case 'ApiFailure':
      if (failure.code === 'mail_send_failed') {
        return 'The test email could not be sent. Check the Resend key and the sender address.';
      }
      if (failure.code === 'rate_limited') {
        return 'Too many attempts, try again later';
      }
      return 'Something went wrong. Try again.';
  }
}

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
  const [step, setStep] = useState<1 | 2>(1);
  const [adminEmail, setAdminEmail] = useState('');
  const [resendApiKey, setResendApiKey] = useState('');
  const [from, setFrom] = useState(DEFAULT_FROM);
  const [emailError, setEmailError] = useState<string | undefined>(undefined);

  // Retry runs the same query again; while it runs the page shows 'checking'.
  const [setupStatus, retryStatus] = useQuery(
    () => fromApi(() => getSetupStatus()).pipe(Effect.map((result) => result.needsSetup)),
    [],
  );
  const status: 'checking' | 'ready' | 'done' | 'statusFailed' =
    isWaiting(setupStatus) || AsyncResult.isInitial(setupStatus)
      ? 'checking'
      : AsyncResult.isSuccess(setupStatus)
        ? setupStatus.value
          ? 'ready'
          : 'done'
        : 'statusFailed';

  // The server's answer to the setup request. A second submit while it waits
  // is dropped (mode 'ignore').
  const [setupState, runSetup, setupControls] = useAction<void, SetupResult, SetupFailure>(
    (): Effect.Effect<SetupResult, SetupFailure> => {
      if (resendApiKey.trim() === '') {
        return Effect.fail(new KeyMissing());
      }
      if (from.trim() === '') {
        return Effect.fail(new FromMissing());
      }
      return fromApi(() =>
        postSetup({
          resendApiKey: resendApiKey.trim(),
          from: from.trim(),
          adminEmail: adminEmail.trim(),
        }),
      );
    },
  );
  const busy = isWaiting(setupState);
  const setupFailure = busy ? undefined : failureOf(setupState);
  const error =
    emailError ?? (setupFailure === undefined ? undefined : setupErrorText(setupFailure));
  // The invite code stays in memory only (never in storage, URL or logs).
  const inviteCode = AsyncResult.isSuccess(setupState) ? setupState.value.inviteCode : undefined;

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
              retryStatus();
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
      setEmailError('Enter a valid admin email address');
      return;
    }
    setEmailError(undefined);
    setStep(2);
  };

  const submitSetup = (event: React.FormEvent): void => {
    event.preventDefault();
    runSetup();
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
                  setupControls.reset();
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
