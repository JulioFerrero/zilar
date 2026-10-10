import { Effect } from 'effect';
import { useFocusEffect, useRouter } from 'expo-router';
import { Lock } from 'lucide-react-native';
import { useCallback, useState } from 'react';
import { View } from 'react-native';

import { RequireAuth } from '@/auth/RequireAuth';
import { EmailCard } from '@/components/integrations/email-card';
import { TelegramCard } from '@/components/integrations/telegram-card';
import { VoiceCard } from '@/components/integrations/voice-card';
import { useIntegrationsApi } from '@/components/integrations/use-integrations-api';
import { SettingsScreenShell } from '@/components/settings/screen-shell';
import { StateMessage } from '@/components/ui/state-message';
import { Text } from '@/components/ui/text';
import { ICON } from '@/lib/colors';
import type { IntegrationsStatus, VoiceIntegrationStatus } from '@/lib/integrations-api';
import { useAction } from '@/lib/effect/use-action';

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
 *
 * The screens keep their state in React `useState`; every network call is an
 * Effect run by `useAction`, which writes its result back into that state.
 * `useAction` also ignores a second press while a call runs and interrupts a
 * running call on unmount.
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
  const { api } = useIntegrationsApi();

  const [data, setData] = useState<IntegrationsStatus | null>(null);
  const [status, setStatus] = useState<PageStatus>('loading');
  const [errorInfo, setErrorInfo] = useState<{ message: string }>({ message: '' });

  // Latest reload wins: a focus reload replaces a load still in flight.
  const [, load] = useAction(
    () =>
      Effect.tryPromise({
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
            if (cause instanceof Error && 'status' in cause && cause.status === 404) {
              setStatus('forbidden');
            } else {
              setErrorInfo({ message: 'Could not load integrations.' });
              setStatus('error');
            }
          }),
        ),
      ),
    { mode: 'replace' },
  );

  const reload = useCallback(() => {
    setStatus('loading');
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
