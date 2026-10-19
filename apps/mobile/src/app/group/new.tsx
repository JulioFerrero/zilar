import { Effect } from 'effect';
import { useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ScrollView, View } from 'react-native';

import { RequireAuth } from '@/auth/RequireAuth';
import {
  buildGroupCreateInput,
  createErrorText,
  useHandleCheck,
  type CreateVisibility,
  VisibilityFields,
  type HandleCheckState,
} from '@/components/chat/visibility-fields';
import { makeDirectoryApi } from '@zilar/client-core';
import { useApi } from '@/lib/use-mockable-api';
import { NewGroupMembers } from '@/components/group/new-group-members';
import { Button } from '@/components/ui/button';
import { ScreenHeader } from '@/components/ui/screen-header';
import { Text, TextField } from '@/components/ui/text';
import type { Contact } from '@/lib/contacts-api';
import { failureOf, isWaiting, useAction } from '@/lib/effect/use-action';
import { toggleSelected } from '@/lib/selection';
import { useChatStore } from '@/store/chat-store-provider';
import { EntityAvatar } from '@/components/chat/entity-avatar';

function NewGroupName({
  members,
  title,
  onTitle,
  visibility,
  onVisibility,
  handle,
  onHandle,
  check,
  checking,
  localError,
  error,
}: {
  members: Contact[];
  title: string;
  onTitle: (next: string) => void;
  visibility: CreateVisibility;
  onVisibility: (next: CreateVisibility) => void;
  handle: string;
  onHandle: (next: string) => void;
  check: HandleCheckState | null;
  checking: boolean;
  localError: string;
  error: string;
}) {
  return (
    <ScrollView
      className="flex-1"
      contentContainerStyle={{ paddingBottom: 32 }}
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="interactive"
      automaticallyAdjustKeyboardInsets
    >
      <View className="p-4">
        <View className="mb-4 flex-row items-center gap-3">
          <View className="flex-row gap-2">
            {members.slice(0, 6).map((person) => (
              <EntityAvatar key={person.userId} person={person} size={40} />
            ))}
          </View>
          <Text className="text-[14px] text-muted-foreground">
            {members.length} {members.length === 1 ? 'member' : 'members'}
          </Text>
        </View>

        <TextField
          label="Group name"
          value={title}
          onChangeText={onTitle}
          autoCapitalize="sentences"
          autoFocus
          placeholder="Group name"
          accessibilityLabel="Group name"
          maxLength={100}
        />

        <VisibilityFields
          kind="group"
          visibility={visibility}
          onVisibility={onVisibility}
          handle={handle}
          onHandle={onHandle}
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
      </View>
    </ScrollView>
  );
}

type GroupCreateInput = {
  title: string;
  memberIds: string[];
  visibility?: 'public';
  handle?: string;
};

export default function NewGroupScreen() {
  return (
    <RequireAuth>
      <NewGroupFlow />
    </RequireAuth>
  );
}

function NewGroupFlow() {
  const router = useRouter();
  const contacts = useChatStore((state) => state.contacts);
  const createGroup = useChatStore((state) => state.createGroup);

  const [step, setStep] = useState<'members' | 'name'>('members');
  const [selected, setSelected] = useState<string[]>([]);
  const [title, setTitle] = useState('');
  const [localError, setLocalError] = useState('');
  // Private (default, invite-only) or Public with its own checked `@handle`.
  const [visibility, setVisibility] = useState<CreateVisibility>('private');
  const [handle, setHandle] = useState('');
  const { api: directoryApi } = useApi(makeDirectoryApi);
  const checkHandle = useCallback(
    (value: string) => directoryApi.checkGroupHandle(value),
    [directoryApi],
  );
  const { check, checking, reset } = useHandleCheck(visibility, handle, checkHandle);

  const [createState, submit] = useAction((input: GroupCreateInput) =>
    Effect.tryPromise({
      try: () => createGroup(input),
      catch: (reason) => reason,
    }).pipe(
      Effect.tap((groupId) =>
        Effect.sync(() => {
          router.replace({ pathname: '/group/[id]', params: { id: groupId } });
        }),
      ),
    ),
  );
  const busy = isWaiting(createState);
  const failure = failureOf(createState);
  const createError = !busy && failure !== undefined ? createErrorText(failure, 'group') : '';

  const members = selected
    .map((userId) => contacts.find((contact) => contact.userId === userId))
    .filter((contact): contact is Contact => contact !== undefined);

  const goBack = () => {
    if (step === 'name') {
      setStep('members');
    } else {
      router.back();
    }
  };

  const create = () => {
    if (busy) {
      return;
    }
    const guarded = buildGroupCreateInput(title, selected, visibility, handle, check);
    if ('error' in guarded) {
      setLocalError(guarded.error);
      return;
    }
    setLocalError('');
    submit(guarded.input);
  };

  const pickVisibility = (next: CreateVisibility) => {
    setVisibility(next);
    reset();
    setLocalError('');
  };

  const changeHandle = (next: string) => {
    setHandle(next);
    reset();
  };

  return (
    <SafeAreaView className="flex-1 bg-background" edges={['top']}>
      <ScreenHeader
        variant="sub"
        title="New group"
        subtitle={
          step === 'members'
            ? 'Add members'
            : `${selected.length} ${selected.length === 1 ? 'member' : 'members'}`
        }
        onBack={goBack}
        right={
          step === 'members' ? (
            <Button
              variant="ghost"
              size="sm"
              accessibilityLabel="Next"
              disabled={selected.length === 0}
              onPress={() => setStep('name')}
            >
              <Text>Next</Text>
            </Button>
          ) : (
            <Button
              variant="ghost"
              size="sm"
              accessibilityLabel="Create group"
              disabled={busy}
              onPress={create}
            >
              <Text>{busy ? 'Creating…' : 'Create'}</Text>
            </Button>
          )
        }
      />

      {step === 'members' ? (
        <NewGroupMembers
          contacts={contacts}
          selected={selected}
          onToggle={(userId) => setSelected((current) => toggleSelected(current, userId))}
        />
      ) : (
        <NewGroupName
          members={members}
          title={title}
          onTitle={setTitle}
          visibility={visibility}
          onVisibility={pickVisibility}
          handle={handle}
          onHandle={changeHandle}
          check={check}
          checking={checking}
          localError={localError}
          error={createError}
        />
      )}
    </SafeAreaView>
  );
}
