import { useCallback, useState } from 'react';
import { Pressable, View } from 'react-native';

import {
  buildChannelCreateInput,
  VisibilityFields,
  useHandleCheck,
  type CreateVisibility,
} from '@/components/chat/visibility-fields';
import { useDirectoryApi } from '@/components/directory/use-directory-api';
import { Button } from '@/components/ui/button';
import { Text } from '@/components/ui/text';
import { TextField } from '@/components/ui/text-field';
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
  onCreate: (input: {
    title: string;
    description?: string;
    visibility?: 'public';
    handle?: string;
  }) => void;
  onClose: () => void;
}) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  // T-0228: Private (default, invite-only) or Public (its own `@handle`,
  // checked live, created in the same step).
  const [visibility, setVisibility] = useState<CreateVisibility>('private');
  const [handle, setHandle] = useState('');
  const [localError, setLocalError] = useState('');
  const { api: directoryApi } = useDirectoryApi();
  // Memoized like the group sheet's, for the same reason: the effect deps
  // only see visibility/handle, never a fresh closure identity.
  const checkHandle = useCallback(
    (value: string) => directoryApi.checkGroupHandle(value),
    [directoryApi],
  );
  const { check, checking, reset } = useHandleCheck(visibility, handle, checkHandle);

  const trimmed = title.trim();
  const tooLong = description.length > 300;
  const canCreate = trimmed !== '' && !tooLong && !busy;

  const create = () => {
    if (busy) {
      return;
    }
    const guarded = buildChannelCreateInput(title, description, visibility, handle, check);
    if ('error' in guarded) {
      setLocalError(guarded.error);
      return;
    }
    setLocalError('');
    onCreate(guarded.input);
  };

  return (
    <Pressable
      onPress={() => {}}
      className="w-full max-w-xs rounded-2xl border border-border-strong bg-surface p-4"
    >
      <Text className="text-[16px] font-semibold text-foreground">New channel</Text>
      <Text className="mt-1 text-[14px] text-muted-foreground">
        Only you and the admins you add will post. Everyone else subscribes.
      </Text>
      <TextField
        value={title}
        onChangeText={setTitle}
        autoCapitalize="sentences"
        placeholder="Channel name"
        accessibilityLabel="Channel name"
        maxLength={100}
        className="mt-3"
      />
      <TextField
        value={description}
        onChangeText={setDescription}
        autoCapitalize="sentences"
        placeholder="Description (optional)"
        accessibilityLabel="Channel description"
        multiline
        className="mt-2"
      />
      {tooLong ? (
        <Text accessibilityRole="alert" className="mt-2 text-[14px] text-danger">
          The description must be at most 300 characters.
        </Text>
      ) : null}
      <VisibilityFields
        kind="channel"
        visibility={visibility}
        onVisibility={(next) => {
          setVisibility(next);
          reset();
          setLocalError('');
        }}
        handle={handle}
        onHandle={(next) => {
          setHandle(next);
          reset();
        }}
        check={check}
        checking={checking}
      />
      {localError !== '' ? (
        <Text accessibilityRole="alert" className="mt-2 text-[14px] text-danger">
          {localError}
        </Text>
      ) : null}
      {error !== '' ? (
        <Text accessibilityRole="alert" className="mt-2 text-[14px] text-danger">
          {error}
        </Text>
      ) : null}
      <View className="mt-3 flex-row justify-end gap-2">
        <Button variant="ghost" accessibilityLabel="Cancel" disabled={busy} onPress={onClose}>
          <Text>Cancel</Text>
        </Button>
        <Button accessibilityLabel="Create channel" disabled={!canCreate} onPress={create}>
          <Text>{busy ? 'Creating…' : 'Create'}</Text>
        </Button>
      </View>
    </Pressable>
  );
}
