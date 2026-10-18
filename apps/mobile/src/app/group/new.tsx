import { Effect } from 'effect';
import { useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { SafeAreaView } from 'react-native-safe-area-context';

import { RequireAuth } from '@/auth/RequireAuth';
import {
  buildGroupCreateInput,
  createErrorText,
  useHandleCheck,
  type CreateVisibility,
} from '@/components/chat/visibility-fields';
import { useDirectoryApi } from '@/components/directory/use-directory-api';
import { NewGroupMembers } from '@/components/group/new-group-members';
import { NewGroupName } from '@/components/group/new-group-name';
import { Button } from '@/components/ui/button';
import { ScreenHeader } from '@/components/ui/screen-header';
import { Text } from '@/components/ui/text';
import type { Contact } from '@/lib/contacts-api';
import { failureOf, isWaiting, useAction } from '@/lib/effect/use-action';
import { toggleSelected } from '@/lib/selection';
import { useChatStore } from '@/store/chat-store-provider';

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
  const { api: directoryApi } = useDirectoryApi();
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
