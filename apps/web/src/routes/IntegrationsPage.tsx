import {
  TokenMissing,
  friendlyError,
  shownFailure,
  type PageStatus,
} from '../components/settings/integrationErrors';
import { useIntegrationSave } from '../components/settings/useIntegrationSave';
import { EmailCard } from '@/components/settings/EmailCard';
import { VoiceTranscriptionCard } from '@/components/settings/VoiceTranscriptionCard';
import { SETTINGS_COLUMN, SettingsShell } from '@/components/SettingsShell';
import { Button } from '@/components/ui/button';
import { StateMessage } from '@/components/ui/state-message';
import { SecretInput } from '@/components/ui/text-input';
import {
  getIntegrationsStatus,
  type IntegrationsStatus,
  removeTelegramBotToken,
  saveTelegramBotToken,
} from '@/lib/api';
import { failureOf, isWaiting } from '@/lib/effect/use-action';
import { useQuery } from '@/lib/effect/use-query';
import { fromApi } from '@zilar/client-core';
import { AsyncResult } from 'effect/reactivity';
import { useState } from 'react';
import { useNavigate } from 'react-router';
/** The server owner's key shelf: Email, Telegram and voice transcription cards. The page is
 * owner-only (the same 404 as an unknown route otherwise), and the token and the key are
 * never shown, not even masked. */

type TelegramOp = { readonly kind: 'save'; readonly token: string } | { readonly kind: 'remove' };

function TelegramCard({
  telegram,
  onSaved,
}: {
  telegram: IntegrationsStatus['telegram'];
  onSaved: (next: IntegrationsStatus['telegram']) => void;
}) {
  const managedByEnv = telegram.source === 'env';
  const [token, setToken] = useState('');
  const [state, runTelegram] = useIntegrationSave<TelegramOp, 'saved' | 'removed', TokenMissing>({
    write: (op) =>
      op.kind === 'remove' ? removeTelegramBotToken() : saveTelegramBotToken(op.token.trim()),
    validate: (op) =>
      op.kind === 'save' && op.token.trim() === '' ? new TokenMissing() : undefined,
    clearInput: (op) => {
      if (op.kind === 'save') {
        setToken('');
      }
    },
    onSaved: (next) => onSaved(next.telegram),
    value: (op) => (op.kind === 'save' ? 'saved' : 'removed'),
  });

  const busy = isWaiting(state);
  const saved = !busy && AsyncResult.isSuccess(state) && state.value === 'saved';
  const failure = shownFailure(state);
  const errorMessage =
    failure === undefined
      ? ''
      : failure._tag === 'TokenMissing'
        ? 'Paste the bot token first.'
        : friendlyError(failure);

  return (
    <section
      aria-label="Telegram"
      className="flex flex-col gap-2 rounded-xl border border-border bg-surface px-3 py-2.5"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-[16px] font-semibold">Telegram</h2>
        <span className="rounded-full bg-surface-raised px-2 py-0.5 text-[12px] text-muted-foreground">
          {managedByEnv
            ? 'Connected (set by environment variable)'
            : telegram.configured
              ? 'Connected'
              : 'Not set up'}
        </span>
      </div>
      <p className="text-[14px] text-muted-foreground">
        A bot token lets people import public sticker packs into their own private packs.
      </p>
      <p className="text-[13px] text-muted-foreground">
        Open @BotFather in Telegram, send /newbot, and copy the token it gives you.
      </p>
      {managedByEnv ? (
        <p className="text-[14px] text-muted-foreground">
          The token is set by environment variable — remove it there to use a stored one.
        </p>
      ) : (
        <>
          <label className="flex flex-col gap-1 text-[14px]">
            Bot token
            <SecretInput
              value={token}
              aria-label="Bot token"
              placeholder="123456:ABC-…"
              maxLength={256}
              autoComplete="off"
              disabled={busy}
              revealLabel={{ show: 'Show token', hide: 'Hide token' }}
              onChange={(event) => setToken(event.target.value)}
            />
          </label>
          {errorMessage !== '' && (
            <p role="alert" className="text-[14px] text-danger">
              {errorMessage}
            </p>
          )}
          {saved && <p className="text-[14px] text-online">Saved — imports are on.</p>}
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              size="default"
              onClick={() => runTelegram({ kind: 'save', token })}
              disabled={busy}
            >
              {busy ? 'Checking…' : 'Save'}
            </Button>
            {telegram.configured && (
              <Button
                type="button"
                variant="outline"
                onClick={() => runTelegram({ kind: 'remove' })}
                disabled={busy}
              >
                Remove
              </Button>
            )}
          </div>
        </>
      )}
    </section>
  );
}

export function IntegrationsPage() {
  const navigate = useNavigate();
  const [loaded, refresh] = useQuery(() => fromApi(() => getIntegrationsStatus()), []);
  const [patched, setPatched] = useState<Partial<IntegrationsStatus>>({});
  const data = AsyncResult.isSuccess(loaded) ? { ...loaded.value, ...patched } : undefined;

  const failed = AsyncResult.isFailure(loaded) && !isWaiting(loaded);
  const failure = failed ? failureOf(loaded) : undefined;
  const status: PageStatus = failed ? 'forbidden' : data === undefined ? 'loading' : 'ready';
  const errorMessage =
    failure !== undefined && failure.code !== 'unknown_error' && failure.status !== 404
      ? friendlyError(failure)
      : '';

  return (
    <SettingsShell
      title="Integrations"
      subtitle="Keys and senders for the services this server talks to."
      onBack={() => navigate('/settings')}
    >
      <div className={SETTINGS_COLUMN}>
        {status === 'loading' && <StateMessage kind="loading" title="Loading integrations…" />}

        {status === 'forbidden' && (
          <div className="flex flex-col gap-3">
            <p className="text-[14px] text-muted-foreground">
              Only the person who runs this server can change integrations.
            </p>
            {errorMessage !== '' && (
              <p role="alert" className="text-[14px] text-danger">
                {errorMessage}
              </p>
            )}
            {errorMessage !== '' && (
              <div>
                <Button type="button" size="lg" onClick={() => refresh()}>
                  Retry
                </Button>
              </div>
            )}
          </div>
        )}

        {status === 'ready' && data !== undefined && (
          <div className="flex flex-col gap-4">
            <EmailCard
              email={data.email}
              onSaved={(next) => setPatched((current) => ({ ...current, email: next }))}
            />
            <TelegramCard
              telegram={data.telegram}
              onSaved={(next) => setPatched((current) => ({ ...current, telegram: next }))}
            />
            <VoiceTranscriptionCard
              voiceTranscription={
                data.voiceTranscription ?? { configured: false, baseUrl: null, model: null }
              }
              onSaved={(next) =>
                setPatched((current) => ({ ...current, voiceTranscription: next }))
              }
            />
          </div>
        )}
      </div>
    </SettingsShell>
  );
}
