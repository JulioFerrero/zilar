import { Effect } from 'effect';
import { useFocusEffect, useRouter } from 'expo-router';
import { Lock } from 'lucide-react-native';
import { useCallback, useState } from 'react';
import { View } from 'react-native';

import { RequireAuth } from '@/auth/RequireAuth';
import { EmailCard } from '@/components/integrations/email-card';
import { TelegramCard } from '@/components/integrations/telegram-card';
import { VoiceCard } from '@/components/integrations/voice-card';
import { SettingsScreenShell } from '@/components/settings/screen-shell';
import { StateMessage } from '@/components/ui/state-message';
import { Text } from '@/components/ui/text';
import { ICON } from '@/lib/colors';
import { type IntegrationsStatus, type VoiceIntegrationStatus } from '@/lib/integrations-api';
import { useAction } from '@/lib/effect/use-action';
import { useApi } from '@/lib/use-mockable-api';
import { makeIntegrationsApi } from '@zilar/client-core';

type PageStatus = 'loading' | 'ready' | 'forbidden' | 'error';

const UNCONFIGURED_VOICE: VoiceIntegrationStatus = {
  configured: false,
  baseUrl: null,
  model: null,
};

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
