import { ScrollView, View } from 'react-native';

import {
  VisibilityFields,
  type CreateVisibility,
  type HandleCheckState,
} from '@/components/chat/visibility-fields';
import { EntityAvatar } from '@/components/chat/entity-avatar';
import { Text } from '@/components/ui/text';
import { TextField } from '@/components/ui/text-field';
import type { Contact } from '@/lib/contacts-api';

/**
 * The New group flow's name step (T-1314): the picked members, the required
 * group name, and the shared visibility fields (the same public-group option
 * the old sheet carried). Create lives in the screen's header.
 */
export function NewGroupName({
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
  /** The local guard sentence (empty name, missing handle). */
  localError: string;
  /** The create failure sentence from the server. */
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
