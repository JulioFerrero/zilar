import { Mail } from 'lucide-react-native';
import { useState } from 'react';
import { View } from 'react-native';

import { CardHeader, SaveButton, SecretField } from './card-fields';
import { saveEmailCard } from './card-save';
import { useCardSave } from './use-card-actions';
import { Text } from '@/components/ui/text';
import { TextField } from '@/components/ui/text-field';
import { ICON } from '@/lib/colors';
import type {
  EmailIntegrationStatus,
  IntegrationsApi,
  IntegrationsStatus,
} from '@/lib/integrations-api';

export function EmailCard({
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
          {save.error !== '' ? (
            <Text accessibilityRole="alert" className="text-[14px] text-danger">
              {save.error}
            </Text>
          ) : null}
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
