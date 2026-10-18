import { Effect } from 'effect';
import { AsyncResult } from 'effect/reactivity';
import { MoreVertical, User, UserMinus } from 'lucide-react-native';
import { useMemo, useState } from 'react';
import { View } from 'react-native';

import { ActionSheet, ActionSheetItem } from '@/components/ui/action-sheet';
import { Card } from '@/components/ui/card';
import { IconButton } from '@/components/ui/icon-button';
import { SearchField } from '@/components/ui/search-field';
import { StateMessage } from '@/components/ui/state-message';
import { Text } from '@/components/ui/text';
import { ICON } from '@/lib/colors';
import type { Contact } from '@/lib/contacts-api';
import { isWaiting, useAction } from '@/lib/effect/use-action';
import type { ChatSummary } from '@/lib/types';

import {
  contactOnline,
  contactPresence,
  filterContacts,
  sortContactsByPresence,
} from './contact-presence';
import { ContactRow } from './contact-row';

function subtitleFor(person: Contact, chats: ChatSummary[], now: Date): string {
  const presence = contactPresence(person, chats, now);
  if (presence !== undefined) {
    return presence;
  }
  return person.handle !== undefined && person.handle !== null ? `@${person.handle}` : '';
}

export function ContactList({
  people,
  chats,
  onOpenChat,
  onViewProfile,
  onRemove,
}: {
  people: Contact[];
  chats: ChatSummary[];
  onOpenChat: (person: Contact) => void;
  onViewProfile: (handle: string) => void;
  onRemove: (userId: string) => Promise<string | null>;
}) {
  const [query, setQuery] = useState('');
  const [menuFor, setMenuFor] = useState<Contact | null>(null);
  const [confirmFor, setConfirmFor] = useState<Contact | null>(null);
  const now = new Date();

  const visible = useMemo(
    () => sortContactsByPresence(filterContacts(people, query), chats),
    [people, chats, query],
  );

  const [removeState, runRemove, removeControls] = useAction((person: Contact) =>
    Effect.promise(() => onRemove(person.userId)),
  );
  const removing = isWaiting(removeState);
  const removeFailure = AsyncResult.isSuccess(removeState) ? removeState.value : undefined;

  // A successful removal drops the row upstream; close the confirm with it.
  // Reset during render, so no effect synchronizes state.
  if (confirmFor !== null && AsyncResult.isSuccess(removeState) && removeState.value === null) {
    setConfirmFor(null);
  }

  const startRemove = (person: Contact) => {
    removeControls.reset();
    setMenuFor(null);
    setConfirmFor(person);
  };

  const closeConfirm = () => {
    if (!removing) {
      setConfirmFor(null);
    }
  };

  return (
    <>
      <SearchField
        value={query}
        onChangeText={setQuery}
        onClear={() => setQuery('')}
        maxLength={100}
        placeholder="Search contacts"
        accessibilityLabel="Search contacts"
        autoCapitalize="none"
        autoCorrect={false}
        containerClassName="mb-3"
      />

      {visible.length === 0 ? (
        <StateMessage
          kind="empty"
          title={people.length === 0 ? 'No contacts yet.' : 'No contacts match.'}
        />
      ) : (
        <View accessibilityRole="none" accessibilityLabel="Contacts">
          <Card>
            {visible.map((person) => (
              <ContactRow
                key={person.userId}
                person={person}
                subtitle={subtitleFor(person, chats, now)}
                online={contactOnline(person, chats)}
                accessibilityLabel={`Open the chat with ${person.name}`}
                onPress={() => onOpenChat(person)}
                onLongPress={() => setMenuFor(person)}
                trailing={
                  <IconButton
                    label={`More options for ${person.name}`}
                    onPress={() => setMenuFor(person)}
                    className="h-9 w-9"
                  >
                    <MoreVertical size={20} color={ICON} />
                  </IconButton>
                }
              />
            ))}
          </Card>
        </View>
      )}

      <ActionSheet
        visible={menuFor !== null}
        onClose={() => setMenuFor(null)}
        closeLabel="Close contact menu"
        title={menuFor?.name}
      >
        {menuFor?.handle !== undefined && menuFor.handle !== null && menuFor.handle !== '' ? (
          <ActionSheetItem
            label="View profile"
            icon={User}
            onPress={() => {
              const handle = menuFor.handle;
              if (handle !== undefined && handle !== null) {
                setMenuFor(null);
                onViewProfile(handle);
              }
            }}
          />
        ) : null}
        <ActionSheetItem
          label="Remove contact"
          icon={UserMinus}
          destructive
          onPress={() => {
            if (menuFor !== null) {
              startRemove(menuFor);
            }
          }}
        />
      </ActionSheet>

      <ActionSheet
        visible={confirmFor !== null}
        onClose={closeConfirm}
        closeLabel="Cancel removing contact"
        header={
          <View className="px-4 py-3">
            <Text className="text-[14px] text-foreground">
              {`Remove ${confirmFor?.name ?? ''}? They stay in your chats; you stop being contacts.`}
            </Text>
          </View>
        }
        error={typeof removeFailure === 'string' ? removeFailure : ''}
      >
        <ActionSheetItem
          label={removing ? 'Removing…' : 'Remove contact'}
          destructive
          disabled={removing}
          onPress={() => {
            if (confirmFor !== null) {
              runRemove(confirmFor);
            }
          }}
        />
        <ActionSheetItem label="Cancel" disabled={removing} onPress={closeConfirm} />
      </ActionSheet>
    </>
  );
}
