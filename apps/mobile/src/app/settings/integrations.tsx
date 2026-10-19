import { Effect } from 'effect';
import { useFocusEffect, useRouter } from 'expo-router';
import { Lock, Mail, Mic, Send } from 'lucide-react-native';
import { useCallback, useState } from 'react';
import { View } from 'react-native';

import { RequireAuth } from '@/auth/RequireAuth';
import {
  CardHeader,
  RemoveButton,
  RemoveConfirmDialog,
  SaveButton,
  SecretField,
} from '@/components/integrations/card-fields';
import {
  removeIntegrationCard,
  saveEmailCard,
  saveTelegramCard,
  saveVoiceCard,
  type CardSaveOutcome,
} from '@/components/integrations/card-save';
import { SettingsScreenShell } from '@/components/settings/screen-shell';
import { StateMessage } from '@/components/ui/state-message';
import { Text, TextField } from '@/components/ui/text';
import { ICON } from '@/lib/colors';
import { useAction } from '@/lib/effect/use-action';
import { useApi } from '@/lib/use-mockable-api';
import {
  type EmailIntegrationStatus,
  type IntegrationsStatus,
  type TelegramIntegrationStatus,
  type VoiceIntegrationStatus,
} from '@zilar/api-contract';
import { makeIntegrationsApi, type IntegrationsApi } from '@zilar/client-core';

type PageStatus = 'loading' | 'ready' | 'forbidden' | 'error';

const UNCONFIGURED_VOICE: VoiceIntegrationStatus = {
  configured: false,
  baseUrl: null,
  model: null,
};

function SaveError({ error }: { error: string }) {
  if (error === '') {
    return null;
  }
  return (
    <Text accessibilityRole="alert" className="text-[14px] text-danger">
      {error}
    </Text>
  );
}

/**
 * Anyone who is not the owner gets the same 404 as an unknown route. Secrets are write-only: never prefilled, cleared the moment a save succeeds, never rendered, logged or stored anywhere else.
 */
export default function IntegrationsScreen() {
  return (
    <RequireAuth>
      <IntegrationsBody />
    </RequireAuth>
  );
}

function IntegrationsBody() {
  const router = useRouter();
  const { api } = useApi(makeIntegrationsApi);

  const [data, setData] = useState<IntegrationsStatus | null>(null);
  const [status, setStatus] = useState<PageStatus>('loading');
  const [errorInfo, setErrorInfo] = useState<{ message: string }>({ message: '' });

  const [, load] = useAction(
    () => {
      const keepContent = status === 'ready';
      return Effect.tryPromise({
        try: () => api.getIntegrationsStatus(),
        catch: (cause: unknown) => cause,
      }).pipe(
        Effect.tap((loaded) =>
          Effect.sync(() => {
            setData(loaded);
            setStatus('ready');
          }),
        ),
        Effect.catch((cause) =>
          Effect.sync(() => {
            if (keepContent) {
              return;
            }
            if (cause instanceof Error && 'status' in cause && cause.status === 404) {
              setStatus('forbidden');
            } else {
              setErrorInfo({ message: 'Could not load integrations.' });
              setStatus('error');
            }
          }),
        ),
      );
    },
    { mode: 'replace' },
  );

  const reload = useCallback(() => {
    setStatus((current) => (current === 'ready' ? current : 'loading'));
    load(undefined);
  }, [load]);

  useFocusEffect(
    useCallback(() => {
      reload();
    }, [reload]),
  );

  return (
    <SettingsScreenShell
      title="Integrations"
      subtitle="Telegram, email and transcription for this server."
      onBack={() => router.back()}
      onRefresh={reload}
    >
      <View className="gap-4">
        {status === 'loading' ? (
          <StateMessage kind="loading" title="Loading integrations…" />
        ) : null}

        {status === 'forbidden' ? (
          <View className="items-center gap-3 px-6 pt-16">
            <Lock size={32} color={ICON} />
            <Text className="text-center text-[15px] text-muted-foreground">
              Only the server owner can change these settings.
            </Text>
          </View>
        ) : null}

        {status === 'error' ? (
          <StateMessage
            kind="error"
            title={errorInfo.message}
            action={{
              label: 'Retry',
              accessibilityLabel: 'Retry loading integrations',
              onPress: reload,
            }}
          />
        ) : null}

        {status === 'ready' && data !== null ? (
          <>
            <EmailCard api={api} email={data.email} onSaved={setData} />
            <VoiceCard
              api={api}
              voice={data.voiceTranscription ?? UNCONFIGURED_VOICE}
              onSaved={setData}
            />
            <TelegramCard api={api} telegram={data.telegram} onSaved={setData} />
          </>
        ) : null}
      </View>
    </SettingsScreenShell>
  );
}

function EmailCard({
  api,
  email,
  onSaved,
}: {
  api: IntegrationsApi;
  email: EmailIntegrationStatus;
  onSaved: (next: IntegrationsStatus) => void;
}) {
  const managedByEnv = email.source === 'env';
  const [from, setFrom] = useState(email.from ?? '');
  const [key, setKey] = useState('');
  const [showKey, setShowKey] = useState(false);

  const save = useCardSave({
    request: (draft: { from: string; key: string }) => saveEmailCard(api, draft),
    secret: { set: setKey, hide: () => setShowKey(false) },
    onSaved,
  });

  const onSavePress = (): void => {
    if (from.trim() === '') {
      save.fail('Enter the sender address first.');
      return;
    }
    if (save.busy) {
      return;
    }
    save.submit({ from, key });
  };

  return (
    <View className="gap-3 rounded-xl border border-border bg-surface p-4">
      <CardHeader
        icon={<Mail size={20} color={ICON} />}
        title="Email"
        pill={
          managedByEnv ? 'Managed by environment' : email.configured ? 'Connected' : 'Not set up'
        }
      />
      <Text className="text-[14px] leading-5 text-muted-foreground">
        The sender on sign-in emails.
      </Text>
      {email.from !== null ? (
        <Text selectable className="text-[13px] leading-5 text-muted-foreground">
          Now: {email.from}
        </Text>
      ) : null}
      {managedByEnv ? (
        <Text className="text-[14px] text-muted-foreground">
          Email is managed by environment variables on this server. Change it there, not here.
        </Text>
      ) : (
        <>
          <View className="gap-1">
            <Text className="text-[14px] font-medium text-foreground">From address</Text>
            <TextField
              value={from}
              onChangeText={setFrom}
              accessibilityLabel="From address"
              keyboardType="email-address"
              autoCapitalize="none"
              autoCorrect={false}
              maxLength={320}
              editable={!save.busy}
              returnKeyType="next"
              placeholder="Zilar <no-reply@mail.example.com>"
            />
          </View>
          <Text className="text-[13px] leading-5 text-muted-foreground">
            Use an address on a domain you verified in Resend.
          </Text>
          <SecretField
            label="New Resend API key"
            value={key}
            onChange={setKey}
            placeholder="re_…"
            maxLength={256}
            show={showKey}
            onToggleShow={() => setShowKey((value) => !value)}
            showLabel="key"
            editable={!save.busy}
            returnKeyType="done"
          />
          <Text className="text-[13px] leading-5 text-muted-foreground">
            Leave empty to keep the current key.
          </Text>
          <SaveError error={save.error} />
          {save.saved ? (
            <Text className="text-[14px] text-online">
              Saved. A test email is on its way to your address.
            </Text>
          ) : null}
          <View className="flex-row items-center gap-2">
            <SaveButton
              busy={save.busy}
              busyLabel="Sending a test email…"
              label="Save"
              onPress={onSavePress}
            />
          </View>
        </>
      )}
    </View>
  );
}

function VoiceCard({
  api,
  voice,
  onSaved,
}: {
  api: IntegrationsApi;
  voice: VoiceIntegrationStatus;
  onSaved: (next: IntegrationsStatus) => void;
}) {
  const [baseUrl, setBaseUrl] = useState(voice.baseUrl ?? '');
  const [model, setModel] = useState(voice.model ?? 'whisper-1');
  const [key, setKey] = useState('');
  const [showKey, setShowKey] = useState(false);

  const save = useCardSave({
    request: (draft: { baseUrl: string; model: string; key: string }) => saveVoiceCard(api, draft),
    secret: { set: setKey, hide: () => setShowKey(false) },
    onSaved,
  });

  const remove = useCardRemove({
    api,
    kind: 'voice',
    onRemoved: (next) => {
      save.clearSaved();
      onSaved(next);
    },
  });

  const onSavePress = (): void => {
    if (baseUrl.trim() === '') {
      save.fail('Enter the endpoint base URL first.');
      return;
    }
    if (save.busy) {
      return;
    }
    save.submit({ baseUrl, model, key });
  };

  return (
    <View className="gap-3 rounded-xl border border-border bg-surface p-4">
      <CardHeader
        icon={<Mic size={20} color={ICON} />}
        title="Voice transcription"
        pill={voice.configured ? 'Connected' : 'Not set up'}
      />
      <Text className="text-[14px] leading-5 text-muted-foreground">
        Adds a Show transcript control under voice messages.
      </Text>
      <Text className="text-[13px] leading-5 text-muted-foreground">
        Transcription on this phone needs no setup. This endpoint adds server transcripts.
      </Text>
      <View className="gap-1">
        <Text className="text-[14px] font-medium text-foreground">Base URL</Text>
        <TextField
          value={baseUrl}
          onChangeText={setBaseUrl}
          accessibilityLabel="Base URL"
          keyboardType="url"
          autoCapitalize="none"
          autoCorrect={false}
          maxLength={512}
          editable={!save.busy}
          returnKeyType="next"
          placeholder="https://api.openai.com/v1"
        />
      </View>
      <View className="gap-1">
        <Text className="text-[14px] font-medium text-foreground">Model</Text>
        <TextField
          value={model}
          onChangeText={setModel}
          accessibilityLabel="Model"
          autoCapitalize="none"
          autoCorrect={false}
          maxLength={128}
          editable={!save.busy}
          returnKeyType="next"
          placeholder="whisper-1"
        />
      </View>
      <SecretField
        label="API key"
        value={key}
        onChange={setKey}
        placeholder="sk-…"
        maxLength={512}
        show={showKey}
        onToggleShow={() => setShowKey((value) => !value)}
        showLabel="key"
        editable={!save.busy}
        returnKeyType="done"
      />
      <Text className="text-[13px] leading-5 text-muted-foreground">
        Optional. Leave empty for a self-hosted server without one. The key is never shown again
        after saving.
      </Text>
      <Text className="text-[13px] leading-5 text-muted-foreground">
        Any OpenAI-compatible transcription endpoint works.
      </Text>
      <SaveError error={save.error} />
      {save.saved ? (
        <Text className="text-[14px] text-online">Saved. Transcripts are on.</Text>
      ) : null}
      <View className="flex-row items-center gap-2">
        <SaveButton busy={save.busy} busyLabel="Checking…" label="Save" onPress={onSavePress} />
        {voice.configured ? (
          <RemoveButton busy={save.busy} label="Remove" onPress={remove.open} />
        ) : null}
      </View>
      {remove.confirming ? (
        <RemoveConfirmDialog
          title="Remove the transcription endpoint?"
          body="The Show transcript control stops working until you save an endpoint again. Transcription on this phone is not affected."
          removing={remove.removing}
          error={remove.confirmError}
          onCancel={remove.cancel}
          onConfirm={remove.confirm}
        />
      ) : null}
    </View>
  );
}

function TelegramCard({
  api,
  telegram,
  onSaved,
}: {
  api: IntegrationsApi;
  telegram: TelegramIntegrationStatus;
  onSaved: (next: IntegrationsStatus) => void;
}) {
  const managedByEnv = telegram.source === 'env';
  const [token, setToken] = useState('');
  const [showToken, setShowToken] = useState(false);

  const save = useCardSave({
    request: (draft: { token: string }) => saveTelegramCard(api, draft),
    secret: { set: setToken, hide: () => setShowToken(false) },
    onSaved,
  });

  const remove = useCardRemove({
    api,
    kind: 'telegram',
    onRemoved: (next) => {
      save.clearSaved();
      onSaved(next);
    },
  });

  const onSavePress = (): void => {
    if (token.trim() === '') {
      save.fail('Paste the bot token first.');
      return;
    }
    if (save.busy) {
      return;
    }
    save.submit({ token });
  };

  return (
    <View className="gap-3 rounded-xl border border-border bg-surface p-4">
      <CardHeader
        icon={<Send size={20} color={ICON} />}
        title="Telegram bot"
        pill={
          managedByEnv ? 'Set by environment' : telegram.configured ? 'Connected' : 'Not set up'
        }
      />
      <Text className="text-[14px] leading-5 text-muted-foreground">
        A bot token lets people import public sticker packs into their own private packs.
      </Text>
      <Text className="text-[13px] leading-5 text-muted-foreground">
        Open @BotFather in Telegram, send /newbot, and copy the token it gives you.
      </Text>
      {managedByEnv ? (
        <Text className="text-[14px] text-muted-foreground">
          The token is set by environment variable. Remove it there to use a stored one.
        </Text>
      ) : (
        <>
          <SecretField
            label="Bot token"
            value={token}
            onChange={setToken}
            placeholder="123456:ABC-…"
            maxLength={256}
            show={showToken}
            onToggleShow={() => setShowToken((value) => !value)}
            showLabel="token"
            editable={!save.busy}
            returnKeyType="done"
          />
          <SaveError error={save.error} />
          {save.saved ? (
            <Text className="text-[14px] text-online">Saved. Imports are on.</Text>
          ) : null}
          <View className="flex-row items-center gap-2">
            <SaveButton busy={save.busy} busyLabel="Checking…" label="Save" onPress={onSavePress} />
            {telegram.configured ? (
              <RemoveButton busy={save.busy} label="Remove" onPress={remove.open} />
            ) : null}
          </View>
        </>
      )}
      {remove.confirming ? (
        <RemoveConfirmDialog
          title="Remove the Telegram token?"
          body="People can no longer import sticker packs from Telegram until you add a token again."
          removing={remove.removing}
          error={remove.confirmError}
          onCancel={remove.cancel}
          onConfirm={remove.confirm}
        />
      ) : null}
    </View>
  );
}

interface CardSecret {
  set: (value: string) => void;
  hide: () => void;
}

interface CardSaveActions<Draft> {
  busy: boolean;
  saved: boolean;
  error: string;
  fail: (message: string) => void;
  submit: (draft: Draft) => void;
  clearSaved: () => void;
}

/**
 * The one save state machine behind the Email, Voice and Telegram cards: it
 * flips `busy`, runs the card's save, writes the outcome into `saved`, `error`
 * and the secret field. The secret clears whenever the save itself succeeded —
 * even when the status reload fails, the server already stores the new secret.
 */
function useCardSave<Draft>({
  request,
  secret,
  onSaved,
}: {
  request: (draft: Draft) => Promise<CardSaveOutcome>;
  secret: CardSecret;
  onSaved: (next: IntegrationsStatus) => void;
}): CardSaveActions<Draft> {
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');

  const [, saveCard] = useAction((draft: Draft) =>
    Effect.sync(() => setBusy(true)).pipe(
      Effect.andThen(Effect.promise(() => request(draft))),
      Effect.tap((outcome) =>
        Effect.sync(() => {
          secret.set(outcome.secretAfterSave);
          if (outcome.status !== null) {
            secret.hide();
            onSaved(outcome.status);
          }
          setSaved(outcome.saved);
          setError(outcome.error);
        }),
      ),
      Effect.ensuring(Effect.sync(() => setBusy(false))),
    ),
  );

  const submit = useCallback(
    (draft: Draft) => {
      setError('');
      setSaved(false);
      saveCard(draft);
    },
    [saveCard],
  );

  const fail = useCallback((message: string) => {
    setError(message);
    setSaved(false);
  }, []);

  const clearSaved = useCallback(() => setSaved(false), []);

  return { busy, saved, error, fail, submit, clearSaved };
}

interface CardRemoveActions {
  confirming: boolean;
  removing: boolean;
  confirmError: string;
  open: () => void;
  cancel: () => void;
  confirm: () => void;
}

/**
 * The one remove state machine behind the Voice and Telegram cards: the dialog
 * closes only after the status reload proves the remove stuck; a failed Remove
 * keeps it open with the error sentence.
 */
function useCardRemove({
  api,
  kind,
  onRemoved,
}: {
  api: IntegrationsApi;
  kind: 'telegram' | 'voice';
  onRemoved: (next: IntegrationsStatus) => void;
}): CardRemoveActions {
  const [confirming, setConfirming] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [confirmError, setConfirmError] = useState('');

  const [, removeCard] = useAction(() =>
    Effect.sync(() => setRemoving(true)).pipe(
      Effect.andThen(Effect.promise(() => removeIntegrationCard(api, kind))),
      Effect.tap((outcome) =>
        Effect.sync(() => {
          if (outcome.status !== null) {
            onRemoved(outcome.status);
            setConfirming(false);
          } else {
            setConfirmError(outcome.error);
          }
        }),
      ),
      Effect.ensuring(Effect.sync(() => setRemoving(false))),
    ),
  );

  const open = useCallback(() => {
    setConfirmError('');
    setConfirming(true);
  }, []);

  const cancel = useCallback(() => setConfirming(false), []);

  const confirm = useCallback(() => {
    if (removing) {
      return;
    }
    setConfirmError('');
    removeCard(undefined);
  }, [removing, removeCard]);

  return { confirming, removing, confirmError, open, cancel, confirm };
}
