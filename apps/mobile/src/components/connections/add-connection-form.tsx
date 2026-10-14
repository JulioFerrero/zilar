import { Effect } from 'effect';
import { AI_PROVIDER_IDS } from '@zilar/chat-core';
import { Eye, EyeOff, X } from 'lucide-react-native';
import { useState } from 'react';
import { View } from 'react-native';

import { providerLabel } from '@/components/ais/providers';
import { keyAfterSave, saveConnection } from '@/components/connections/save-connection';
import { useConnectionsApi } from '@/components/connections/use-connections-api';
import { Button } from '@/components/ui/button';
import { SelectSheet } from '@/components/ui/select-sheet';
import { Text } from '@/components/ui/text';
import { TextField } from '@/components/ui/text-field';
import { ICON } from '@/lib/colors';
import type { ProviderConnection } from '@/lib/connections-api';
import { useAction } from '@/lib/effect/use-action';

/**
 * The add form: a provider picker and a secure key field. The key lives in
 * this component's state only, and is cleared the moment the save resolves —
 * it is never rendered back, logged or passed anywhere but the POST body.
 */
export function AddConnectionForm({
  onCancel,
  onSaved,
  providers = AI_PROVIDER_IDS,
}: {
  onCancel: () => void;
  onSaved: (connection: ProviderConnection) => void;
  /**
   * Which provider ids to offer. Defaults to every provider; the AI wizard
   * passes the LLM ones only, because a GitHub key cannot run an AI.
   */
  providers?: readonly string[];
}) {
  const { api } = useConnectionsApi();
  const [provider, setProvider] = useState<string>(providers[0] ?? 'openai');
  const [key, setKey] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [label, setLabel] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  // T-1396: the custom provider is the only one with a base URL, and the only
  // one whose label is required.
  const isCustom = provider === 'openai-compatible';

  const [, saveForm] = useAction(
    (draft: {
      readonly provider: string;
      readonly key: string;
      readonly label: string;
      readonly baseUrl?: string;
    }) =>
      Effect.sync(() => {
        setBusy(true);
        setError('');
      }).pipe(
        Effect.andThen(Effect.promise(() => saveConnection(api, draft))),
        Effect.tap((outcome) =>
          Effect.sync(() => {
            // Write-only: the transition empties the field on success and keeps
            // the typed key for retry on failure.
            setKey(keyAfterSave(outcome, draft.key));
            setShowKey(false);
            if (outcome.connection !== null) {
              onSaved(outcome.connection);
            } else {
              setError(outcome.error);
            }
          }),
        ),
        Effect.ensuring(Effect.sync(() => setBusy(false))),
      ),
  );

  const submit = (): void => {
    if (busy) {
      return;
    }
    const trimmedKey = key.trim();
    if (trimmedKey === '') {
      setError('Paste your API key.');
      return;
    }
    const trimmedBaseUrl = baseUrl.trim();
    if (isCustom && trimmedBaseUrl === '') {
      setError('Enter a base URL.');
      return;
    }
    const trimmedLabel = label.trim();
    if (isCustom && trimmedLabel === '') {
      setError('Enter a label.');
      return;
    }
    saveForm({
      provider,
      key: trimmedKey,
      label: trimmedLabel,
      ...(isCustom ? { baseUrl: trimmedBaseUrl } : {}),
    });
  };

  return (
    <View className="gap-3 rounded-xl border border-border bg-surface p-4">
      <View className="flex-row items-center justify-between">
        <Text className="text-[16px] font-semibold text-foreground">New connection</Text>
        <Button
          variant="ghost"
          size="icon"
          className="h-9 w-9 rounded-full"
          accessibilityLabel="Close the form"
          onPress={onCancel}
        >
          <X size={16} color={ICON} />
        </Button>
      </View>

      <View className="gap-1">
        <Text className="text-[14px] font-medium text-foreground">Provider</Text>
        <SelectSheet
          label="Provider"
          value={provider}
          options={providers.map((id) => ({ value: id, label: providerLabel(id) }))}
          onChange={setProvider}
        />
      </View>

      {isCustom ? (
        <View className="gap-1">
          <Text className="text-[14px] font-medium text-foreground">Base URL</Text>
          <TextField
            value={baseUrl}
            onChangeText={setBaseUrl}
            accessibilityLabel="Base URL"
            autoCapitalize="none"
            autoCorrect={false}
            maxLength={300}
            placeholder="https://api.groq.com/openai/v1"
          />
        </View>
      ) : null}

      <View className="gap-1">
        <Text className="text-[14px] font-medium text-foreground">API key</Text>
        <View className="flex-row items-center gap-1">
          <TextField
            value={key}
            onChangeText={setKey}
            accessibilityLabel="API key"
            secureTextEntry={!showKey}
            autoCapitalize="none"
            autoCorrect={false}
            maxLength={16384}
            placeholder="Paste your key"
            className="min-w-0 flex-1"
          />
          <Button
            variant="ghost"
            size="icon"
            className="h-9 w-9 rounded-full"
            accessibilityLabel={showKey ? 'Hide key' : 'Show key'}
            onPress={() => setShowKey((value) => !value)}
          >
            {showKey ? <EyeOff size={16} color={ICON} /> : <Eye size={16} color={ICON} />}
          </Button>
        </View>
      </View>

      <View className="gap-1">
        <Text className="text-[14px] font-medium text-foreground">
          {isCustom ? 'Label' : 'Label (optional)'}
        </Text>
        <TextField
          value={label}
          onChangeText={setLabel}
          accessibilityLabel="Label"
          maxLength={256}
          placeholder="Work project"
        />
      </View>

      {error !== '' ? (
        <Text accessibilityRole="alert" className="text-[14px] text-danger">
          {error}
        </Text>
      ) : null}

      <View className="flex-row items-center gap-2">
        <Button
          variant="default"
          size="sm"
          accessibilityLabel="Save the connection"
          disabled={busy}
          onPress={submit}
        >
          <Text>{busy ? 'Saving…' : 'Save'}</Text>
        </Button>
        <Button
          variant="ghost"
          size="sm"
          accessibilityLabel="Cancel"
          disabled={busy}
          onPress={onCancel}
        >
          <Text>Cancel</Text>
        </Button>
      </View>
    </View>
  );
}
