import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { Eye, EyeOff } from 'lucide-react';
import { SETTINGS_COLUMN, SettingsShell } from '@/components/SettingsShell';
import { Button } from '@/components/ui/button';
import { TextInput } from '@/components/ui/text-input';
import {
  ApiError,
  getIntegrationsStatus,
  removeTelegramBotToken,
  removeVoiceTranscriptionSettings,
  saveEmailSettings,
  saveTelegramBotToken,
  saveVoiceTranscriptionSettings,
  type IntegrationsStatus,
} from '@/lib/api';

type PageStatus = 'loading' | 'ready' | 'forbidden';

function friendlyError(error: unknown): string {
  if (error instanceof ApiError) {
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
  return error instanceof Error ? error.message : 'Something went wrong. Try again.';
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
  const [status, setStatus] = useState<PageStatus>('loading');
  const [data, setData] = useState<IntegrationsStatus | undefined>(undefined);
  const [errorMessage, setErrorMessage] = useState('');

  useEffect(() => {
    let active = true;
    getIntegrationsStatus()
      .then((loaded) => {
        if (!active) {
          return;
        }
        setData(loaded);
        setStatus('ready');
      })
      .catch((error: unknown) => {
        if (active) {
          // 404 (not the owner) and load failures both land here: the note
          // below names the owner case, and Retry covers the rest.
          if (error instanceof ApiError && error.status !== 404) {
            setErrorMessage(friendlyError(error));
          }
          setStatus('forbidden');
        }
      });
    return () => {
      active = false;
    };
  }, []);

  const reload = async (): Promise<void> => {
    setStatus('loading');
    setErrorMessage('');
    try {
      const loaded = await getIntegrationsStatus();
      setData(loaded);
      setStatus('ready');
    } catch (error) {
      if (error instanceof ApiError && error.status !== 404) {
        setErrorMessage(friendlyError(error));
      }
      setStatus('forbidden');
    }
  };

  return (
    <SettingsShell
      title="Integrations"
      subtitle="Keys and senders for the services this server talks to."
      onBack={() => navigate('/')}
    >
      <div className={SETTINGS_COLUMN}>
        {status === 'loading' && (
          <p className="text-[14px] text-muted-foreground">Loading integrations…</p>
        )}

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
                <Button type="button" size="lg" onClick={() => void reload()}>
                  Retry
                </Button>
              </div>
            )}
          </div>
        )}

        {status === 'ready' && data !== undefined && (
          <div className="flex flex-col gap-4">
            <EmailCard email={data.email} onSaved={(next) => setData({ ...data, email: next })} />
            <TelegramCard
              telegram={data.telegram}
              onSaved={(next) => setData({ ...data, telegram: next })}
            />
            <VoiceTranscriptionCard
              voiceTranscription={
                data.voiceTranscription ?? { configured: false, baseUrl: null, model: null }
              }
              onSaved={(next) => setData({ ...data, voiceTranscription: next })}
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
  const [showKey, setShowKey] = useState(false);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');

  const save = async (): Promise<void> => {
    setError('');
    setSaved(false);
    if (from.trim() === '') {
      setError('Enter the sender address first.');
      return;
    }
    setBusy(true);
    try {
      const trimmedKey = key.trim();
      await saveEmailSettings(
        trimmedKey === '' ? { from: from.trim() } : { from: from.trim(), resendApiKey: trimmedKey },
      );
      setKey('');
      const next = await getIntegrationsStatus();
      onSaved(next.email);
      // The flag flips only after the reload proved the save stuck; a
      // failed reload clears it so the success line never lies.
      setSaved(true);
    } catch (cause) {
      setSaved(false);
      setError(friendlyError(cause));
    } finally {
      setBusy(false);
    }
  };

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
            <div className="relative">
              <TextInput
                type={showKey ? 'text' : 'password'}
                value={key}
                aria-label="New Resend API key"
                placeholder="re_…"
                maxLength={256}
                autoComplete="off"
                disabled={busy}
                onChange={(event) => setKey(event.target.value)}
                className="pr-10"
              />
              <button
                type="button"
                aria-label={showKey ? 'Hide key' : 'Show key'}
                title={showKey ? 'Hide key' : 'Show key'}
                onClick={() => setShowKey((value) => !value)}
                className="absolute top-1/2 right-1 -translate-y-1/2 rounded-full p-1.5 text-muted-foreground hover:bg-muted"
              >
                {showKey ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
              </button>
            </div>
          </label>
          <p className="text-[13px] text-muted-foreground">Leave empty to keep the current key.</p>
          {error !== '' && (
            <p role="alert" className="text-[14px] text-danger">
              {error}
            </p>
          )}
          {saved && (
            <p className="text-[14px] text-online">
              Saved — a test email is on its way to your address.
            </p>
          )}
          <div>
            <Button type="button" size="default" onClick={() => void save()} disabled={busy}>
              {busy ? 'Sending a test email…' : 'Save'}
            </Button>
          </div>
        </>
      )}
    </section>
  );
}

function VoiceTranscriptionCard({
  voiceTranscription,
  onSaved,
}: {
  voiceTranscription: NonNullable<IntegrationsStatus['voiceTranscription']>;
  onSaved: (next: NonNullable<IntegrationsStatus['voiceTranscription']>) => void;
}) {
  const [baseUrl, setBaseUrl] = useState(voiceTranscription.baseUrl ?? '');
  const [key, setKey] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [model, setModel] = useState(voiceTranscription.model ?? 'whisper-1');
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');

  const save = async (): Promise<void> => {
    setError('');
    setSaved(false);
    if (baseUrl.trim() === '') {
      setError('Enter the endpoint base URL first.');
      return;
    }
    setBusy(true);
    try {
      const trimmedKey = key.trim();
      await saveVoiceTranscriptionSettings({
        baseUrl: baseUrl.trim(),
        ...(trimmedKey === '' ? {} : { apiKey: trimmedKey }),
        model: model.trim() === '' ? 'whisper-1' : model.trim(),
      });
      setKey('');
      const next = await getIntegrationsStatus();
      onSaved(
        next.voiceTranscription ?? {
          configured: true,
          baseUrl: baseUrl.trim(),
          model: model.trim(),
        },
      );
      // Only after the reload proved the save stuck (same as Email).
      setSaved(true);
    } catch (cause) {
      setSaved(false);
      setError(friendlyError(cause));
    } finally {
      setBusy(false);
    }
  };

  const remove = async (): Promise<void> => {
    setError('');
    setSaved(false);
    setBusy(true);
    try {
      await removeVoiceTranscriptionSettings();
      setSaved(false);
      const next = await getIntegrationsStatus();
      onSaved(next.voiceTranscription ?? { configured: false, baseUrl: null, model: null });
    } catch (cause) {
      setError(friendlyError(cause));
    } finally {
      setBusy(false);
    }
  };

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
        <div className="relative">
          <TextInput
            type={showKey ? 'text' : 'password'}
            value={key}
            aria-label="API key"
            placeholder="sk-…"
            maxLength={512}
            autoComplete="off"
            disabled={busy}
            onChange={(event) => setKey(event.target.value)}
            className="pr-10"
          />
          <button
            type="button"
            aria-label={showKey ? 'Hide key' : 'Show key'}
            title={showKey ? 'Hide key' : 'Show key'}
            onClick={() => setShowKey((value) => !value)}
            className="absolute top-1/2 right-1 -translate-y-1/2 rounded-full p-1.5 text-muted-foreground hover:bg-muted"
          >
            {showKey ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
          </button>
        </div>
      </label>
      <p className="text-[13px] text-muted-foreground">
        Optional — leave empty for a self-hosted server without one. The key is never shown again
        after saving.
      </p>
      {error !== '' && (
        <p role="alert" className="text-[14px] text-danger">
          {error}
        </p>
      )}
      {saved && <p className="text-[14px] text-online">Saved — transcripts are on.</p>}
      <div className="flex flex-wrap gap-2">
        <Button type="button" size="default" onClick={() => void save()} disabled={busy}>
          {busy ? 'Checking…' : 'Save'}
        </Button>
        {voiceTranscription.configured && (
          <button
            type="button"
            onClick={() => void remove()}
            disabled={busy}
            className="rounded-full border border-border-strong bg-surface-raised px-4 py-1.5 text-[14px] font-medium text-foreground hover:bg-muted disabled:opacity-60"
          >
            Remove
          </button>
        )}
      </div>
    </section>
  );
}

function TelegramCard({
  telegram,
  onSaved,
}: {
  telegram: IntegrationsStatus['telegram'];
  onSaved: (next: IntegrationsStatus['telegram']) => void;
}) {
  const managedByEnv = telegram.source === 'env';
  const [token, setToken] = useState('');
  const [showToken, setShowToken] = useState(false);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');

  const save = async (): Promise<void> => {
    setError('');
    setSaved(false);
    if (token.trim() === '') {
      setError('Paste the bot token first.');
      return;
    }
    setBusy(true);
    try {
      await saveTelegramBotToken(token.trim());
      setToken('');
      const next = await getIntegrationsStatus();
      onSaved(next.telegram);
      // Only after the reload proved the save stuck (same as Email).
      setSaved(true);
    } catch (cause) {
      setSaved(false);
      setError(friendlyError(cause));
    } finally {
      setBusy(false);
    }
  };

  const remove = async (): Promise<void> => {
    setError('');
    setSaved(false);
    setBusy(true);
    try {
      await removeTelegramBotToken();
      setSaved(false);
      const next = await getIntegrationsStatus();
      onSaved(next.telegram);
    } catch (cause) {
      setError(friendlyError(cause));
    } finally {
      setBusy(false);
    }
  };

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
            <div className="relative">
              <TextInput
                type={showToken ? 'text' : 'password'}
                value={token}
                aria-label="Bot token"
                placeholder="123456:ABC-…"
                maxLength={256}
                autoComplete="off"
                disabled={busy}
                onChange={(event) => setToken(event.target.value)}
                className="pr-10"
              />
              <button
                type="button"
                aria-label={showToken ? 'Hide token' : 'Show token'}
                title={showToken ? 'Hide token' : 'Show token'}
                onClick={() => setShowToken((value) => !value)}
                className="absolute top-1/2 right-1 -translate-y-1/2 rounded-full p-1.5 text-muted-foreground hover:bg-muted"
              >
                {showToken ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
              </button>
            </div>
          </label>
          {error !== '' && (
            <p role="alert" className="text-[14px] text-danger">
              {error}
            </p>
          )}
          {saved && <p className="text-[14px] text-online">Saved — imports are on.</p>}
          <div className="flex flex-wrap gap-2">
            <Button type="button" size="default" onClick={() => void save()} disabled={busy}>
              {busy ? 'Checking…' : 'Save'}
            </Button>
            {telegram.configured && (
              <button
                type="button"
                onClick={() => void remove()}
                disabled={busy}
                className="rounded-full border border-border-strong bg-surface-raised px-4 py-1.5 text-[14px] font-medium text-foreground hover:bg-muted disabled:opacity-60"
              >
                Remove
              </button>
            )}
          </div>
        </>
      )}
    </section>
  );
}
