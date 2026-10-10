import { Send } from 'lucide-react-native';
import { useState } from 'react';
import { View } from 'react-native';

import {
  CardHeader,
  RemoveButton,
  RemoveConfirmDialog,
  SaveButton,
  SecretField,
} from './card-fields';
import { saveTelegramCard } from './card-save';
import { useCardRemove, useCardSave } from './use-card-actions';
import { Text } from '@/components/ui/text';
import { ICON } from '@/lib/colors';
import type {
  IntegrationsApi,
  IntegrationsStatus,
  TelegramIntegrationStatus,
} from '@/lib/integrations-api';

export function TelegramCard({
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
          {save.error !== '' ? (
            <Text accessibilityRole="alert" className="text-[14px] text-danger">
              {save.error}
            </Text>
          ) : null}
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
