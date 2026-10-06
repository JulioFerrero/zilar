import { Check } from 'lucide-react-native';
import { useCallback, useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';

import { Avatar } from '@/components/chat/avatar';
import {
  buildGroupCreateInput as buildGuardedGroupCreateInput,
  VisibilityFields,
  useHandleCheck,
  type CreateVisibility,
} from '@/components/chat/visibility-fields';
import { useDirectoryApi } from '@/components/directory/use-directory-api';
import { Button } from '@/components/ui/button';
import { Text } from '@/components/ui/text';
import { TextField } from '@/components/ui/text-field';
import type { Contact } from '@/lib/chat-api';
import { ICON_COLOR } from '@/lib/depth';

/** Toggles one contact id in the selection. */
export function toggleSelected(selected: string[], userId: string): string[] {
  return selected.includes(userId) ? selected.filter((id) => id !== userId) : [...selected, userId];
}

/** The wrapper's Create payload: trimmed title plus the selected ids. */
export function buildGroupCreateInput(
  title: string,
  selected: string[],
): {
  title: string;
  memberIds: string[];
} {
  return { title: title.trim(), memberIds: selected };
}

/** Guarded Create: builds the payload only when the name validates; undefined sets `localError`. */
export function nextGroupCreateInput(
  title: string,
  selected: string[],
): { title: string; memberIds: string[] } | undefined {
  return validateGroupName(title) === undefined
    ? buildGroupCreateInput(title, selected)
    : undefined;
}

/** The members step advances once at least one contact is picked. */
export function canGoNext(selected: string[]): boolean {
  return selected.length > 0;
}

/** The `Enter a group name` sentence, or undefined when the title is usable. */
export function validateGroupName(title: string): string | undefined {
  return title.trim() === '' ? 'Enter a group name' : undefined;
}

/**
 * The new-group sheet (T-0214, the mobile twin of web's `NewGroupDialog`
 * without the public option): pick contacts, name the group, create it. Same
 * container classes as the `NewChannelSheet` and the `New message` box.
 */
export function NewGroupSheet({
  contacts,
  busy,
  error,
  onCreate,
  onClose,
}: {
  contacts: Contact[];
  busy: boolean;
  error: string;
  onCreate: (input: {
    title: string;
    memberIds: string[];
    visibility?: 'public';
    handle?: string;
  }) => void;
  onClose: () => void;
}) {
  const [step, setStep] = useState<'members' | 'name'>('members');
  const [selected, setSelected] = useState<string[]>([]);
  const [title, setTitle] = useState('');
  const [localError, setLocalError] = useState('');
  // T-0228: Private (default, invite-only) or Public (its own `@handle`,
  // checked live, created in the same step).
  const [visibility, setVisibility] = useState<CreateVisibility>('private');
  const [handle, setHandle] = useState('');
  const { api: directoryApi } = useDirectoryApi();
  // `directoryApi` is memoized, so the checker's identity is stable and the
  // debounced effect in `useHandleCheck` only re-runs on visibility/handle.
  const checkHandle = useCallback(
    (value: string) => directoryApi.checkGroupHandle(value),
    [directoryApi],
  );
  const { check, checking, reset } = useHandleCheck(visibility, handle, checkHandle);

  const create = () => {
    if (busy) {
      return;
    }
    const guarded = buildGuardedGroupCreateInput(title, selected, visibility, handle, check);
    if ('error' in guarded) {
      setLocalError(guarded.error);
      return;
    }
    setLocalError('');
    onCreate(guarded.input);
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
    <NewGroupSheetBody
      contacts={contacts}
      busy={busy}
      error={error}
      step={step}
      selected={selected}
      title={title}
      localError={localError}
      visibility={visibility}
      handle={handle}
      check={check}
      checking={checking}
      onToggle={(userId) => setSelected((current) => toggleSelected(current, userId))}
      onNext={() => setStep('name')}
      onBack={() => setStep('members')}
      onTitle={setTitle}
      onVisibility={pickVisibility}
      onHandle={changeHandle}
      onCreate={create}
      onClose={onClose}
    />
  );
}

/**
 * The hook-free new-group sheet body: Node tests drive it as a plain
 * function with `react-native` stubbed (the `NewMessageSheet` pattern). The
 * stateful `NewGroupSheet` above only owns the step state; this view renders
 * one step. The pure step logic (`toggleSelected`, `canGoNext`,
 * `validateGroupName`) stays testable without a simulator.
 */
export function NewGroupSheetBody({
  contacts,
  busy,
  error,
  step,
  selected,
  title,
  localError,
  visibility,
  handle,
  check,
  checking,
  onToggle,
  onNext,
  onBack,
  onTitle,
  onVisibility,
  onHandle,
  onCreate,
  onClose,
}: {
  contacts: Contact[];
  busy: boolean;
  error: string;
  step: 'members' | 'name';
  selected: string[];
  title: string;
  localError: string;
  visibility: CreateVisibility;
  handle: string;
  check: { available: boolean; reason?: string | undefined } | null;
  checking: boolean;
  onToggle: (userId: string) => void;
  onNext: () => void;
  onBack: () => void;
  onTitle: (next: string) => void;
  onVisibility: (next: CreateVisibility) => void;
  onHandle: (next: string) => void;
  onCreate: () => void;
  onClose: () => void;
}) {
  return (
    <Pressable
      onPress={() => {}}
      className="w-full max-w-xs rounded-2xl border border-border-strong bg-surface p-4"
    >
      {step === 'members' ? (
        <>
          <Text className="text-[16px] font-semibold text-foreground">Add members</Text>
          {contacts.length === 0 ? (
            <Text className="py-6 text-center text-[14px] text-muted-foreground">
              Invite a friend first to start a group.
            </Text>
          ) : (
            <ScrollView className="mt-3 max-h-64">
              {contacts.map((contact) => {
                const checked = selected.includes(contact.userId);
                return (
                  <Pressable
                    key={contact.userId}
                    accessibilityRole="checkbox"
                    accessibilityState={{ checked }}
                    accessibilityLabel={contact.name}
                    onPress={() => onToggle(contact.userId)}
                    className="flex-row items-center gap-3 rounded-lg px-2 py-2 active:bg-surface-raised"
                  >
                    <Avatar id={contact.userId} name={contact.name} size={28} />
                    <Text className="flex-1 text-[15px] text-foreground">{contact.name}</Text>
                    {checked ? <Check size={18} color={ICON_COLOR} /> : null}
                  </Pressable>
                );
              })}
            </ScrollView>
          )}
          <View className="mt-4 flex-row justify-end gap-2">
            <Button variant="ghost" accessibilityLabel="Cancel" disabled={busy} onPress={onClose}>
              <Text>Cancel</Text>
            </Button>
            <Button
              variant="default"
              accessibilityLabel="Next"
              disabled={!canGoNext(selected) || busy}
              onPress={onNext}
            >
              <Text>Next</Text>
            </Button>
          </View>
        </>
      ) : (
        <>
          <Text className="text-[16px] font-semibold text-foreground">Group name</Text>
          <TextField
            value={title}
            onChangeText={onTitle}
            autoCapitalize="sentences"
            autoFocus
            placeholder="Group name"
            accessibilityLabel="Group name"
            maxLength={100}
            className="mt-3"
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
          <View className="mt-3 flex-row justify-end gap-2">
            <Button variant="ghost" accessibilityLabel="Back" disabled={busy} onPress={onBack}>
              <Text>Back</Text>
            </Button>
            <Button
              variant="default"
              accessibilityLabel="Create group"
              disabled={busy}
              onPress={onCreate}
            >
              <Text>{busy ? 'Creating…' : 'Create'}</Text>
            </Button>
          </View>
        </>
      )}
    </Pressable>
  );
}
