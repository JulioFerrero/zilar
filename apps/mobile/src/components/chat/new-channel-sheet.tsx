import { useState } from 'react';
import { Pressable, TextInput, View } from 'react-native';

import { Text } from '@/components/ui/text';

/**
 * The new-channel sheet (T-0144): a title plus an optional description
 * (≤ 300, the channel's short blurb). The screen creates the channel
 * through the store and navigates to it; failures read inline, never raw.
 */
export function NewChannelSheet({
  busy,
  error,
  onCreate,
  onClose,
}: {
  busy: boolean;
  error: string;
  onCreate: (input: { title: string; description?: string }) => void;
  onClose: () => void;
}) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');

  const trimmed = title.trim();
  const tooLong = description.length > 300;
  const canCreate = trimmed !== '' && !tooLong && !busy;

  return (
    <Pressable
      onPress={() => {}}
      className="w-full max-w-xs rounded-2xl border border-border-strong bg-surface p-4"
    >
      <Text className="text-[16px] font-semibold text-foreground">New channel</Text>
      <Text className="mt-1 text-[14px] text-muted-foreground">
        Only you and the admins you add will post. Everyone else subscribes.
      </Text>
      <View className="mt-3 rounded-[10px] border border-border-strong bg-well px-3 py-2">
        <TextInput
          value={title}
          onChangeText={setTitle}
          autoCapitalize="sentences"
          placeholder="Channel name"
          placeholderTextColor="#8a8a8a"
          accessibilityLabel="Channel name"
          maxLength={100}
          className="text-[15px] text-foreground"
        />
      </View>
      <View className="mt-2 rounded-[10px] border border-border-strong bg-well px-3 py-2">
        <TextInput
          value={description}
          onChangeText={setDescription}
          autoCapitalize="sentences"
          placeholder="Description (optional)"
          placeholderTextColor="#8a8a8a"
          accessibilityLabel="Channel description"
          multiline
          className="text-[15px] text-foreground"
        />
      </View>
      {tooLong ? (
        <Text accessibilityRole="alert" className="mt-2 text-[14px] text-danger">
          The description must be at most 300 characters.
        </Text>
      ) : null}
      {error !== '' ? (
        <Text accessibilityRole="alert" className="mt-2 text-[14px] text-danger">
          {error}
        </Text>
      ) : null}
      <View className="mt-3 flex-row justify-end gap-2">
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Cancel"
          disabled={busy}
          onPress={onClose}
          className="rounded-full px-4 py-2 active:bg-surface-raised disabled:opacity-60"
        >
          <Text className="text-[15px] text-muted-foreground">Cancel</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Create channel"
          disabled={!canCreate}
          onPress={() =>
            onCreate({
              title: trimmed,
              ...(description.trim() === '' ? {} : { description: description.trim() }),
            })
          }
          className="rounded-full bg-accent px-4 py-2 active:opacity-90 disabled:opacity-60"
        >
          <Text className="text-[15px] font-medium text-accent-foreground">
            {busy ? 'Creating…' : 'Create'}
          </Text>
        </Pressable>
      </View>
    </Pressable>
  );
}
