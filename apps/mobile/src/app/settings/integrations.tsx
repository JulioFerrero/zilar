import { useFocusEffect, useRouter } from 'expo-router';
import { Eye, EyeOff, Lock, Mail, Mic, RefreshCw, Send } from 'lucide-react-native';
import { useCallback, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, View } from 'react-native';
import { useColorScheme } from 'nativewind';

import { RequireAuth } from '@/auth/RequireAuth';
import {
  removeIntegrationCard,
  saveEmailCard,
  saveTelegramCard,
  saveVoiceCard,
} from '@/components/integrations/card-save';
import { useIntegrationsApi } from '@/components/integrations/use-integrations-api';
import { SettingsScreenShell } from '@/components/settings/screen-shell';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Text } from '@/components/ui/text';
import { TextField } from '@/components/ui/text-field';
import { asColorScheme } from '@/lib/color-scheme';
import { ACCENT, ICON } from '@/lib/colors';
import type {
  EmailIntegrationStatus,
  IntegrationsApi,
  IntegrationsStatus,
  TelegramIntegrationStatus,
  VoiceIntegrationStatus,
} from '@/lib/integrations-api';

type PageStatus = 'loading' | 'ready' | 'forbidden' | 'error';

const UNCONFIGURED_VOICE: VoiceIntegrationStatus = {
  configured: false,
  baseUrl: null,
  model: null,
};

/**
 * Settings → Integrations (mirrors web's `IntegrationsPage`): the owner-only
 * Email, Voice transcription and Telegram bot cards in the web order. Anyone
 * who is not the owner gets the same 404 as an unknown route, so the screen
 * shows the owner sentence instead of the cards. Secrets are write-only: a
 * secret field is never prefilled, is cleared the moment its save succeeds,
 * and is never rendered, logged or stored anywhere else.
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
  const scheme = asColorScheme(useColorScheme().colorScheme);
  const { api } = useIntegrationsApi();

  const [data, setData] = useState<IntegrationsStatus | null>(null);
  const [status, setStatus] = useState<PageStatus>('loading');
  const [errorInfo, setErrorInfo] = useState<{ message: string }>({ message: '' });

  const reload = useCallback(() => {
    setStatus('loading');
    void api
      .getIntegrationsStatus()
      .then((loaded) => {
        setData(loaded);
        setStatus('ready');
      })
      .catch((error: unknown) => {
        if (error instanceof Error && 'status' in error && error.status === 404) {
          setStatus('forbidden');
        } else {
          setErrorInfo({ message: 'Could not load integrations.' });
          setStatus('error');
        }
      });
  }, [api]);

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
    >
      <View className="gap-4">
        {status === 'loading' ? (
          <View className="items-center gap-3 pt-16">
            <ActivityIndicator color={ACCENT[scheme]} />
            <Text className="text-[15px] text-muted-foreground">Loading integrations…</Text>
          </View>
        ) : null}

        {status === 'forbidden' ? (
          <View className="items-center gap-3 px-6 pt-16">
            <Lock size={32} color={ICON[scheme]} />
            <Text className="text-center text-[15px] text-muted-foreground">
              Only the server owner can change these settings.
            </Text>
          </View>
        ) : null}

        {status === 'error' ? (
          <View className="items-center gap-3 pt-16">
            <Text accessibilityRole="alert" className="text-center text-[15px] text-danger">
              {errorInfo.message}
            </Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Retry loading integrations"
              onPress={reload}
              className="flex-row items-center gap-2 rounded-full border border-border-strong px-4 py-2 active:bg-surface-raised"
            >
              <RefreshCw size={16} color={ICON[scheme]} />
              <Text className="text-[15px] text-foreground">Retry</Text>
            </Pressable>
          </View>
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

function CardHeader({ icon, title, pill }: { icon: React.ReactNode; title: string; pill: string }) {
  return (
    <View className="flex-row items-center justify-between gap-2">
      <View className="flex-row items-center gap-2">
        {icon}
        <Text className="text-[16px] font-semibold text-foreground">{title}</Text>
      </View>
      <Text className="rounded-full bg-surface-raised px-2 py-0.5 text-[12px] text-muted-foreground">
        {pill}
      </Text>
    </View>
  );
}

function SecretField({
  label,
  value,
  onChange,
  placeholder,
  maxLength,
  show,
  onToggleShow,
  showLabel,
  editable,
  returnKeyType,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  maxLength: number;
  show: boolean;
  onToggleShow: () => void;
  showLabel: string;
  editable: boolean;
  returnKeyType: 'next' | 'done';
}) {
  const scheme = asColorScheme(useColorScheme().colorScheme);
  return (
    <View className="gap-1">
      <Text className="text-[14px] font-medium text-foreground">{label}</Text>
      <View className="flex-row items-center gap-1">
        <TextField
          value={value}
          onChangeText={onChange}
          accessibilityLabel={label}
          secureTextEntry={!show}
          autoCapitalize="none"
          autoCorrect={false}
          autoComplete="off"
          maxLength={maxLength}
          editable={editable}
          returnKeyType={returnKeyType}
          placeholder={placeholder}
          className="min-w-0 flex-1"
        />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={show ? `Hide ${showLabel}` : `Show ${showLabel}`}
          onPress={onToggleShow}
          className="rounded-full p-2 active:bg-surface-raised"
        >
          {show ? (
            <EyeOff size={16} color={ICON[scheme]} />
          ) : (
            <Eye size={16} color={ICON[scheme]} />
          )}
        </Pressable>
      </View>
    </View>
  );
}

function SaveButton({
  busy,
  busyLabel,
  label,
  onPress,
}: {
  busy: boolean;
  busyLabel: string;
  label: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      disabled={busy}
      onPress={onPress}
      className="rounded-full bg-accent px-4 py-2 active:opacity-90 disabled:opacity-60"
    >
      <Text className="text-[15px] font-medium text-accent-foreground">
        {busy ? busyLabel : label}
      </Text>
    </Pressable>
  );
}

function RemoveButton({
  busy,
  label,
  onPress,
}: {
  busy: boolean;
  label: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      disabled={busy}
      onPress={onPress}
      className="rounded-full border border-border-strong px-4 py-2 active:bg-surface-raised disabled:opacity-60"
    >
      <Text className="text-[15px] text-foreground">{label}</Text>
    </Pressable>
  );
}

function RemoveConfirmDialog({
  title,
  body,
  removing,
  error,
  onCancel,
  onConfirm,
}: {
  title: string;
  body: string;
  removing: boolean;
  error: string;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <ConfirmDialog
      visible
      title={title}
      message={body}
      error={error}
      confirmLabel="Remove"
      busyLabel="Removing…"
      busy={removing}
      onCancel={onCancel}
      onConfirm={onConfirm}
      confirmAccessibilityLabel="Confirm remove"
      destructive
    />
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
  const scheme = asColorScheme(useColorScheme().colorScheme);
  const managedByEnv = email.source === 'env';
  const [from, setFrom] = useState(email.from ?? '');
  const [key, setKey] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');
  const busyRef = useRef(false);

  const save = (): void => {
    setError('');
    setSaved(false);
    if (from.trim() === '') {
      setError('Enter the sender address first.');
      return;
    }
    if (busyRef.current) {
      return;
    }
    busyRef.current = true;
    setBusy(true);
    void saveEmailCard(api, { from, key })
      .then((outcome) => {
        // The key clears whenever the save itself succeeded — even when the
        // status reload fails, the server already stores the new key.
        setKey(outcome.secretAfterSave);
        if (outcome.status !== null) {
          setShowKey(false);
          onSaved(outcome.status);
        }
        setSaved(outcome.saved);
        setError(outcome.error);
      })
      .finally(() => {
        busyRef.current = false;
        setBusy(false);
      });
  };

  return (
    <View className="gap-3 rounded-xl border border-border bg-surface p-4">
      <CardHeader
        icon={<Mail size={20} color={ICON[scheme]} />}
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
              editable={!busy}
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
            editable={!busy}
            returnKeyType="done"
          />
          <Text className="text-[13px] leading-5 text-muted-foreground">
            Leave empty to keep the current key.
          </Text>
          {error !== '' ? (
            <Text accessibilityRole="alert" className="text-[14px] text-danger">
              {error}
            </Text>
          ) : null}
          {saved ? (
            <Text className="text-[14px] text-online">
              Saved. A test email is on its way to your address.
            </Text>
          ) : null}
          <View className="flex-row items-center gap-2">
            <SaveButton busy={busy} busyLabel="Sending a test email…" label="Save" onPress={save} />
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
  const scheme = asColorScheme(useColorScheme().colorScheme);
  const [baseUrl, setBaseUrl] = useState(voice.baseUrl ?? '');
  const [model, setModel] = useState(voice.model ?? 'whisper-1');
  const [key, setKey] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [confirmError, setConfirmError] = useState('');
  const busyRef = useRef(false);
  const removingRef = useRef(false);

  const save = (): void => {
    setError('');
    setSaved(false);
    if (baseUrl.trim() === '') {
      setError('Enter the endpoint base URL first.');
      return;
    }
    if (busyRef.current) {
      return;
    }
    busyRef.current = true;
    setBusy(true);
    void saveVoiceCard(api, { baseUrl, model, key })
      .then((outcome) => {
        // The key clears whenever the save itself succeeded — even when the
        // status reload fails, the server already stores the new key.
        setKey(outcome.secretAfterSave);
        if (outcome.status !== null) {
          setShowKey(false);
          onSaved(outcome.status);
        }
        setSaved(outcome.saved);
        setError(outcome.error);
      })
      .finally(() => {
        busyRef.current = false;
        setBusy(false);
      });
  };

  const confirmRemove = (): void => {
    if (removingRef.current) {
      return;
    }
    removingRef.current = true;
    setRemoving(true);
    setConfirmError('');
    void removeIntegrationCard(api, 'voice')
      .then((outcome) => {
        if (outcome.status !== null) {
          setSaved(false);
          onSaved(outcome.status);
          setConfirming(false);
        } else {
          setConfirmError(outcome.error);
        }
      })
      .finally(() => {
        removingRef.current = false;
        setRemoving(false);
      });
  };

  const openConfirm = (): void => {
    setConfirmError('');
    setConfirming(true);
  };

  return (
    <View className="gap-3 rounded-xl border border-border bg-surface p-4">
      <CardHeader
        icon={<Mic size={20} color={ICON[scheme]} />}
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
          editable={!busy}
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
          editable={!busy}
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
        editable={!busy}
        returnKeyType="done"
      />
      <Text className="text-[13px] leading-5 text-muted-foreground">
        Optional. Leave empty for a self-hosted server without one. The key is never shown again
        after saving.
      </Text>
      <Text className="text-[13px] leading-5 text-muted-foreground">
        Any OpenAI-compatible transcription endpoint works.
      </Text>
      {error !== '' ? (
        <Text accessibilityRole="alert" className="text-[14px] text-danger">
          {error}
        </Text>
      ) : null}
      {saved ? <Text className="text-[14px] text-online">Saved. Transcripts are on.</Text> : null}
      <View className="flex-row items-center gap-2">
        <SaveButton busy={busy} busyLabel="Checking…" label="Save" onPress={save} />
        {voice.configured ? (
          <RemoveButton busy={busy} label="Remove" onPress={openConfirm} />
        ) : null}
      </View>
      {confirming ? (
        <RemoveConfirmDialog
          title="Remove the transcription endpoint?"
          body="The Show transcript control stops working until you save an endpoint again. Transcription on this phone is not affected."
          removing={removing}
          error={confirmError}
          onCancel={() => setConfirming(false)}
          onConfirm={confirmRemove}
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
  const scheme = asColorScheme(useColorScheme().colorScheme);
  const managedByEnv = telegram.source === 'env';
  const [token, setToken] = useState('');
  const [showToken, setShowToken] = useState(false);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [confirmError, setConfirmError] = useState('');
  const busyRef = useRef(false);
  const removingRef = useRef(false);

  const save = (): void => {
    setError('');
    setSaved(false);
    if (token.trim() === '') {
      setError('Paste the bot token first.');
      return;
    }
    if (busyRef.current) {
      return;
    }
    busyRef.current = true;
    setBusy(true);
    void saveTelegramCard(api, { token })
      .then((outcome) => {
        // The token clears whenever the save itself succeeded — even when
        // the status reload fails, the server already stores the new token.
        setToken(outcome.secretAfterSave);
        if (outcome.status !== null) {
          setShowToken(false);
          onSaved(outcome.status);
        }
        setSaved(outcome.saved);
        setError(outcome.error);
      })
      .finally(() => {
        busyRef.current = false;
        setBusy(false);
      });
  };

  const confirmRemove = (): void => {
    if (removingRef.current) {
      return;
    }
    removingRef.current = true;
    setRemoving(true);
    setConfirmError('');
    void removeIntegrationCard(api, 'telegram')
      .then((outcome) => {
        if (outcome.status !== null) {
          setSaved(false);
          onSaved(outcome.status);
          setConfirming(false);
        } else {
          setConfirmError(outcome.error);
        }
      })
      .finally(() => {
        removingRef.current = false;
        setRemoving(false);
      });
  };

  const openConfirm = (): void => {
    setConfirmError('');
    setConfirming(true);
  };

  return (
    <View className="gap-3 rounded-xl border border-border bg-surface p-4">
      <CardHeader
        icon={<Send size={20} color={ICON[scheme]} />}
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
            editable={!busy}
            returnKeyType="done"
          />
          {error !== '' ? (
            <Text accessibilityRole="alert" className="text-[14px] text-danger">
              {error}
            </Text>
          ) : null}
          {saved ? <Text className="text-[14px] text-online">Saved. Imports are on.</Text> : null}
          <View className="flex-row items-center gap-2">
            <SaveButton busy={busy} busyLabel="Checking…" label="Save" onPress={save} />
            {telegram.configured ? (
              <RemoveButton busy={busy} label="Remove" onPress={openConfirm} />
            ) : null}
          </View>
        </>
      )}
      {confirming ? (
        <RemoveConfirmDialog
          title="Remove the Telegram token?"
          body="People can no longer import sticker packs from Telegram until you add a token again."
          removing={removing}
          error={confirmError}
          onCancel={() => setConfirming(false)}
          onConfirm={confirmRemove}
        />
      ) : null}
    </View>
  );
}
