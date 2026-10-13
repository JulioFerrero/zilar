import { Effect } from 'effect';
import { useRouter } from 'expo-router';
import { ChevronLeft } from 'lucide-react-native';
import { useCallback, useState } from 'react';
import { View } from 'react-native';
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
import { IconButton } from '@/components/ui/icon-button';
import { Text } from '@/components/ui/text';
import { ICON } from '@/lib/colors';
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

/**
 * The full-screen New group flow (T-1314, the Telegram-style twin of the old
 * `NewGroupSheet`): step 1 picks members (search, chips, round checkboxes) and
 * step 2 names the group, then reuses the same `createGroup` store call. Next
 * and Create sit in the header.
 */
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
  // T-0228: Private (default, invite-only) or Public with its own checked
  // `@handle`; the fields keep the same guards the old sheet used.
  const [visibility, setVisibility] = useState<CreateVisibility>('private');
  const [handle, setHandle] = useState('');
  const { api: directoryApi } = useDirectoryApi();
  const checkHandle = useCallback(
    (value: string) => directoryApi.checkGroupHandle(value),
    [directoryApi],
  );
  const { check, checking, reset } = useHandleCheck(visibility, handle, checkHandle);

  // The same create-group call the sheet made: it refreshes the chat list and
  // returns the new group id, then the group screen opens over this form.
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
      <View className="flex-row items-center gap-1 px-2 py-2">
        <IconButton label="Back" onPress={goBack}>
          <ChevronLeft size={24} color={ICON} />
        </IconButton>
        <View className="min-w-0 flex-1">
          <Text numberOfLines={1} className="text-[20px] font-semibold leading-6 text-foreground">
            New group
          </Text>
          <Text numberOfLines={1} className="mt-0.5 text-[14px] leading-5 text-muted-foreground">
            {step === 'members'
              ? 'Add members'
              : `${selected.length} ${selected.length === 1 ? 'member' : 'members'}`}
          </Text>
        </View>
        {step === 'members' ? (
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
        )}
      </View>

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
