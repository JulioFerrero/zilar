import { useState } from 'react';
import { AsyncResult } from 'effect/reactivity';
import { Button } from '@/components/ui/button';
import { SecretInput, TextInput } from '@/components/ui/text-input';
import { saveEmailSettings, type IntegrationsStatus } from '@/lib/api';
import { isWaiting } from '@/lib/effect/use-action';
import { SenderMissing, friendlyError, shownFailure } from './integrationErrors';
import { useIntegrationSave } from './useIntegrationSave';

export function EmailCard({
  email,
  onSaved,
}: {
  email: IntegrationsStatus['email'];
  onSaved: (next: IntegrationsStatus['email']) => void;
}) {
  const managedByEnv = email.source === 'env';
  const [from, setFrom] = useState(email.from ?? '');
  const [key, setKey] = useState('');
  const [state, saveEmail] = useIntegrationSave<
    { readonly from: string; readonly key: string },
    void,
    SenderMissing
  >({
    write: (draft) => {
      const trimmedFrom = draft.from.trim();
      const trimmedKey = draft.key.trim();
      return saveEmailSettings(
        trimmedKey === '' ? { from: trimmedFrom } : { from: trimmedFrom, resendApiKey: trimmedKey },
      );
    },
    validate: (draft) => (draft.from.trim() === '' ? new SenderMissing() : undefined),
    clearInput: () => setKey(''),
    onSaved: (next) => onSaved(next.email),
    value: () => undefined,
  });

  const busy = isWaiting(state);
  const saved = !busy && AsyncResult.isSuccess(state);
  const failure = shownFailure(state);
  const errorMessage =
    failure === undefined
      ? ''
      : failure._tag === 'SenderMissing'
        ? 'Enter the sender address first.'
        : friendlyError(failure);

  return (
    <section
      aria-label="Email"
      className="flex flex-col gap-2 rounded-xl border border-border bg-surface px-3 py-2.5"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-[16px] font-semibold">Email</h2>
        <span className="rounded-full bg-surface-raised px-2 py-0.5 text-[12px] text-muted-foreground">
          {managedByEnv ? 'Managed by environment' : email.configured ? 'Connected' : 'Not set up'}
        </span>
      </div>
      <p className="text-[14px] text-muted-foreground">
        The sender on sign-in emails{email.from ? ` — currently ${email.from}` : ''}.
      </p>
      {managedByEnv ? (
        <p className="text-[14px] text-muted-foreground">
          Email is managed by environment variables on this server — change it there, not here.
        </p>
      ) : (
        <>
          <label className="flex flex-col gap-1 text-[14px]">
            From address
            <TextInput
              value={from}
              aria-label="From address"
              placeholder="Zilar <no-reply@mail.example.com>"
              maxLength={320}
              disabled={busy}
              onChange={(event) => setFrom(event.target.value)}
            />
          </label>
          <p className="text-[13px] text-muted-foreground">
            Use an address on a domain you verified in Resend, for example{' '}
            <code>Zilar &lt;no-reply@mail.example.com&gt;</code>. <code>onboarding@resend.dev</code>{' '}
            only sends to your own Resend account email.
          </p>
          <label className="flex flex-col gap-1 text-[14px]">
            New Resend API key
            <SecretInput
              value={key}
              aria-label="New Resend API key"
              placeholder="re_…"
              maxLength={256}
              autoComplete="off"
              disabled={busy}
              onChange={(event) => setKey(event.target.value)}
            />
          </label>
          <p className="text-[13px] text-muted-foreground">Leave empty to keep the current key.</p>
          {errorMessage !== '' && (
            <p role="alert" className="text-[14px] text-danger">
              {errorMessage}
            </p>
          )}
          {saved && (
            <p className="text-[14px] text-online">
              Saved — a test email is on its way to your address.
            </p>
          )}
          <div>
            <Button
              type="button"
              size="default"
              onClick={() => saveEmail({ from, key })}
              disabled={busy}
            >
              {busy ? 'Sending a test email…' : 'Save'}
            </Button>
          </div>
        </>
      )}
    </section>
  );
}
