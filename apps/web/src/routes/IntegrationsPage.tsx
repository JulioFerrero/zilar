import { useState } from 'react';
import { useNavigate } from 'react-router';
import { Data, Effect } from 'effect';
import { AsyncResult } from 'effect/reactivity';
import { SETTINGS_COLUMN, SettingsShell } from '@/components/SettingsShell';
import { Button } from '@/components/ui/button';
import { StateMessage } from '@/components/ui/state-message';
import { SecretInput, TextInput } from '@/components/ui/text-input';
import {
  getIntegrationsStatus,
  removeTelegramBotToken,
  removeVoiceTranscriptionSettings,
  saveEmailSettings,
  saveTelegramBotToken,
  saveVoiceTranscriptionSettings,
  type IntegrationsStatus,
} from '@/lib/api';
import { fromApi } from '@/lib/effect/api-effect';
import type { ApiFailure } from '@/lib/effect/errors';
import { failureOf, isWaiting, useAction } from '@/lib/effect/use-action';
import { useQuery } from '@/lib/effect/use-query';

type PageStatus = 'loading' | 'ready' | 'forbidden';

/** The form's own checks, each one before anything is sent. */
class SenderMissing extends Data.TaggedError('SenderMissing') {}
class EndpointMissing extends Data.TaggedError('EndpointMissing') {}
class TokenMissing extends Data.TaggedError('TokenMissing') {}

/** The last failure, hidden while a new call runs (the page cleared it at once before). */
function shownFailure<A, E>(state: AsyncResult.AsyncResult<A, E>): E | undefined {
  return isWaiting(state) ? undefined : failureOf(state);
}

function friendlyError(error: ApiFailure): string {
  if (error.code === 'unknown_error') {
    return 'Something went wrong. Try again.';
  }
  if (error.code === 'invalid_token') {
    return 'Telegram rejected the bot token. Check it and try again.';
  }
  if (error.code === 'mail_send_failed') {
    return 'The test email could not be sent. Check the Resend key and the sender address.';
  }
  if (error.code === 'managed_by_environment') {
    return 'Email is managed by environment variables on this server.';
  }
  if (error.code === 'endpoint_unreachable') {
    return 'The transcription endpoint could not be reached. Check the URL.';
  }
  if (error.code === 'endpoint_rejected') {
    return 'The transcription endpoint rejected the test request. Check the URL, key and model.';
  }
  if (error.code === 'rate_limited') {
    return 'Too many tries — wait a little and try again.';
  }
  if (error.code === 'network_error') {
    return 'Could not reach the server.';
  }
  return error.message;
}

/**
 * Settings → Integrations (T-0162 + Email follow-up + T-0170 voice
 * transcription). The server owner's key shelf: an Email card (sign-in
 * sender + Resend key), a Telegram card (bot token for sticker import) and
 * a Voice transcription card (OpenAI-compatible endpoint for on-demand
 * voice transcripts). The page is a generic list of
 * integration cards so a GIF provider key can join later (not built now).
 *
 * The page itself is owner-only: `GET /api/settings/integrations` answers
 * the same 404 as an unknown route for anyone else, so a non-owner (or a
 * failed load) sees the owner note instead of the cards. The token and
 * the key are never shown, not even masked.
 */
export function IntegrationsPage() {
  const navigate = useNavigate();
  const [loaded, refresh] = useQuery(() => fromApi(() => getIntegrationsStatus()), []);
  // A card that saves or removes puts its reloaded part here, so the page shows it at once.
  const [patched, setPatched] = useState<Partial<IntegrationsStatus>>({});
  const data = AsyncResult.isSuccess(loaded) ? { ...loaded.value, ...patched } : undefined;

  // A failed load shows the owner note; while a retry runs, the page is loading again.
  const failed = AsyncResult.isFailure(loaded) && !isWaiting(loaded);
  const failure = failed ? failureOf(loaded) : undefined;
  const status: PageStatus = failed ? 'forbidden' : data === undefined ? 'loading' : 'ready';
  // 404 (not the owner) and unknown load failures get the note alone; a server answer gets its message and Retry.
  const errorMessage =
    failure !== undefined && failure.code !== 'unknown_error' && failure.status !== 404
      ? friendlyError(failure)
      : '';

  return (
    <SettingsShell
      title="Integrations"
      subtitle="Keys and senders for the services this server talks to."
      onBack={() => navigate('/')}
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

function EmailCard({
  email,
  onSaved,
}: {
  email: IntegrationsStatus['email'];
  onSaved: (next: IntegrationsStatus['email']) => void;
}) {
  const managedByEnv = email.source === 'env';
  const [from, setFrom] = useState(email.from ?? '');
  const [key, setKey] = useState('');
  const [state, saveEmail] = useAction(
    (draft: {
      readonly from: string;
      readonly key: string;
    }): Effect.Effect<void, SenderMissing | ApiFailure> => {
      const trimmedFrom = draft.from.trim();
      if (trimmedFrom === '') {
        return Effect.fail(new SenderMissing());
      }
      const trimmedKey = draft.key.trim();
      return fromApi(() =>
        saveEmailSettings(
          trimmedKey === ''
            ? { from: trimmedFrom }
            : { from: trimmedFrom, resendApiKey: trimmedKey },
        ),
      ).pipe(
        Effect.tap(() => Effect.sync(() => setKey(''))),
        Effect.andThen(fromApi(() => getIntegrationsStatus())),
        // The flag flips only after the reload proved the save stuck; a
        // failed reload fails the action, so the success line never lies.
        Effect.tap((next) => Effect.sync(() => onSaved(next.email))),
        Effect.asVoid,
      );
    },
  );

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

type VoiceOp =
  | {
      readonly kind: 'save';
      readonly baseUrl: string;
      readonly key: string;
      readonly model: string;
    }
  | { readonly kind: 'remove' };

function VoiceTranscriptionCard({
  voiceTranscription,
  onSaved,
}: {
  voiceTranscription: NonNullable<IntegrationsStatus['voiceTranscription']>;
  onSaved: (next: NonNullable<IntegrationsStatus['voiceTranscription']>) => void;
}) {
  const [baseUrl, setBaseUrl] = useState(voiceTranscription.baseUrl ?? '');
  const [key, setKey] = useState('');
  const [model, setModel] = useState(voiceTranscription.model ?? 'whisper-1');
  const [state, runVoice] = useAction(
    (op: VoiceOp): Effect.Effect<'saved' | 'removed', EndpointMissing | ApiFailure> => {
      if (op.kind === 'remove') {
        return fromApi(() => removeVoiceTranscriptionSettings()).pipe(
          Effect.andThen(fromApi(() => getIntegrationsStatus())),
          Effect.tap((next) =>
            Effect.sync(() =>
              onSaved(next.voiceTranscription ?? { configured: false, baseUrl: null, model: null }),
            ),
          ),
          Effect.as('removed' as const),
        );
      }
      const trimmedBaseUrl = op.baseUrl.trim();
      if (trimmedBaseUrl === '') {
        return Effect.fail(new EndpointMissing());
      }
      const trimmedKey = op.key.trim();
      const trimmedModel = op.model.trim();
      return fromApi(() =>
        saveVoiceTranscriptionSettings({
          baseUrl: trimmedBaseUrl,
          ...(trimmedKey === '' ? {} : { apiKey: trimmedKey }),
          model: trimmedModel === '' ? 'whisper-1' : trimmedModel,
        }),
      ).pipe(
        Effect.tap(() => Effect.sync(() => setKey(''))),
        Effect.andThen(fromApi(() => getIntegrationsStatus())),
        // Only after the reload proved the save stuck (same as Email).
        Effect.tap((next) =>
          Effect.sync(() =>
            onSaved(
              next.voiceTranscription ?? {
                configured: true,
                baseUrl: trimmedBaseUrl,
                model: trimmedModel,
              },
            ),
          ),
        ),
        Effect.as('saved' as const),
      );
    },
  );

  const busy = isWaiting(state);
  const saved = !busy && AsyncResult.isSuccess(state) && state.value === 'saved';
  const failure = shownFailure(state);
  const errorMessage =
    failure === undefined
      ? ''
      : failure._tag === 'EndpointMissing'
        ? 'Enter the endpoint base URL first.'
        : friendlyError(failure);

  return (
    <section
      aria-label="Voice transcription"
      className="flex flex-col gap-2 rounded-xl border border-border bg-surface px-3 py-2.5"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-[16px] font-semibold">Voice transcription</h2>
        <span className="rounded-full bg-surface-raised px-2 py-0.5 text-[12px] text-muted-foreground">
          {voiceTranscription.configured ? 'Connected' : 'Not set up'}
        </span>
      </div>
      <p className="text-[14px] text-muted-foreground">
        Adds a “Show transcript” control under voice messages
        {voiceTranscription.model ? ` — currently ${voiceTranscription.model}` : ''}. Transcription
        is off until an endpoint is saved. Audio goes only to the endpoint below, never anywhere
        else.
      </p>
      <p className="text-[13px] text-muted-foreground">
        Any OpenAI-compatible <code>/audio/transcriptions</code> endpoint works: OpenAI (
        <code>https://api.openai.com/v1</code>), Groq (<code>https://api.groq.com/openai/v1</code>),
        or a self-hosted Whisper server (plain http is allowed only for localhost or a private
        address).
      </p>
      <label className="flex flex-col gap-1 text-[14px]">
        Base URL
        <TextInput
          value={baseUrl}
          aria-label="Base URL"
          placeholder="https://api.openai.com/v1"
          maxLength={512}
          disabled={busy}
          onChange={(event) => setBaseUrl(event.target.value)}
        />
      </label>
      <label className="flex flex-col gap-1 text-[14px]">
        Model
        <TextInput
          value={model}
          aria-label="Model"
          placeholder="whisper-1"
          maxLength={128}
          disabled={busy}
          onChange={(event) => setModel(event.target.value)}
        />
      </label>
      <label className="flex flex-col gap-1 text-[14px]">
        API key
        <SecretInput
          value={key}
          aria-label="API key"
          placeholder="sk-…"
          maxLength={512}
          autoComplete="off"
          disabled={busy}
          onChange={(event) => setKey(event.target.value)}
        />
      </label>
      <p className="text-[13px] text-muted-foreground">
        Optional — leave empty for a self-hosted server without one. The key is never shown again
        after saving.
      </p>
      {errorMessage !== '' && (
        <p role="alert" className="text-[14px] text-danger">
          {errorMessage}
        </p>
      )}
      {saved && <p className="text-[14px] text-online">Saved — transcripts are on.</p>}
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          size="default"
          onClick={() => runVoice({ kind: 'save', baseUrl, key, model })}
          disabled={busy}
        >
          {busy ? 'Checking…' : 'Save'}
        </Button>
        {voiceTranscription.configured && (
          <Button
            type="button"
            variant="outline"
            onClick={() => runVoice({ kind: 'remove' })}
            disabled={busy}
          >
            Remove
          </Button>
        )}
      </div>
    </section>
  );
}

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
  const [state, runTelegram] = useAction(
    (op: TelegramOp): Effect.Effect<'saved' | 'removed', TokenMissing | ApiFailure> => {
      if (op.kind === 'remove') {
        return fromApi(() => removeTelegramBotToken()).pipe(
          Effect.andThen(fromApi(() => getIntegrationsStatus())),
          Effect.tap((next) => Effect.sync(() => onSaved(next.telegram))),
          Effect.as('removed' as const),
        );
      }
      const trimmedToken = op.token.trim();
      if (trimmedToken === '') {
        return Effect.fail(new TokenMissing());
      }
      return fromApi(() => saveTelegramBotToken(trimmedToken)).pipe(
        Effect.tap(() => Effect.sync(() => setToken(''))),
        Effect.andThen(fromApi(() => getIntegrationsStatus())),
        // Only after the reload proved the save stuck (same as Email).
        Effect.tap((next) => Effect.sync(() => onSaved(next.telegram))),
        Effect.as('saved' as const),
      );
    },
  );

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
