import { Mic } from 'lucide-react-native';
import { useState } from 'react';
import { View } from 'react-native';

import {
  CardHeader,
  RemoveButton,
  RemoveConfirmDialog,
  SaveButton,
  SecretField,
} from './card-fields';
import { saveVoiceCard } from './card-save';
import { useCardRemove, useCardSave } from './use-card-actions';
import { Text } from '@/components/ui/text';
import { TextField } from '@/components/ui/text-field';
import { ICON } from '@/lib/colors';
import type {
  IntegrationsApi,
  IntegrationsStatus,
  VoiceIntegrationStatus,
} from '@/lib/integrations-api';

export function VoiceCard({
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
      {save.error !== '' ? (
        <Text accessibilityRole="alert" className="text-[14px] text-danger">
          {save.error}
        </Text>
      ) : null}
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
