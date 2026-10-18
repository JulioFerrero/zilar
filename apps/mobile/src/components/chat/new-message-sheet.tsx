import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { View } from 'react-native';

import { ContactRow } from '@/components/contacts/contact-row';
import { BottomSheet } from '@/components/ui/bottom-sheet';
import { Button } from '@/components/ui/button';
import { SearchField } from '@/components/ui/search-field';
import { Text } from '@/components/ui/text';
import type { Contact } from '@/lib/contacts-api';
import { useChatStore } from '@/store/chat-store-provider';

// Case-insensitive prefix match on any word of the name, or on the handle.
function matchesFilter(contact: Contact, needle: string): boolean {
  if (needle === '') {
    return true;
  }
  if (
    contact.name
      .toLowerCase()
      .split(/\s+/)
      .some((word) => word.startsWith(needle))
  ) {
    return true;
  }
  const handle = contact.handle;
  return handle != null && handle.toLowerCase().startsWith(needle);
}

// The new-message box, the phone twin of web's `NewMessageDialog`: with no contacts it keeps the invite sentence; otherwise a search field lists contacts and a tap opens the DM, reloading the chat list when the chat is missing. `Invite a friend` is the one sticky footer key.
export function NewMessageSheet({
  visible,
  onInvite,
  onClose,
}: {
  visible: boolean;
  onInvite: () => void;
  onClose: () => void;
}) {
  const router = useRouter();
  const contacts = useChatStore((state) => state.contacts);
  const chats = useChatStore((state) => state.chats);
  const reloadChats = useChatStore((state) => state.reloadChats);
  const [query, setQuery] = useState('');

  // The sheet stays mounted while dismissed, so every close path clears the filter and the next open starts clean.
  const close = (): void => {
    setQuery('');
    onClose();
  };

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return contacts.filter((contact) => matchesFilter(contact, needle));
  }, [contacts, query]);

  // The DM already exists server-side; the chat list only has to catch up.
  const openContact = (contact: Contact): void => {
    if (!chats.some((chat) => chat.id === contact.jid)) {
      reloadChats();
    }
    close();
    router.push({ pathname: '/chat/[id]', params: { id: contact.jid } });
  };

  return (
    <BottomSheet
      visible={visible}
      onClose={close}
      closeLabel="Close new message"
      title="New message"
      footer={
        <Button accessibilityLabel="Invite a friend" onPress={onInvite}>
          <Text>Invite a friend</Text>
        </Button>
      }
    >
      {contacts.length === 0 ? (
        <Text className="mt-1 text-[15px] text-muted-foreground">
          Invite a friend to start a conversation, or type their @username in the search bar above.
        </Text>
      ) : (
        <>
          <SearchField
            value={query}
            onChangeText={setQuery}
            onClear={() => setQuery('')}
            placeholder="Search contacts"
            accessibilityLabel="Search contacts"
            autoCorrect={false}
            autoCapitalize="none"
          />
          <View className="mt-2">
            {filtered.length === 0 ? (
              <Text className="py-6 text-center text-[14px] text-muted-foreground">
                No contacts found
              </Text>
            ) : (
              filtered.map((contact) => (
                <ContactRow
                  key={contact.userId}
                  person={contact}
                  subtitle={
                    contact.handle != null && contact.handle !== '' ? `@${contact.handle}` : ''
                  }
                  accessibilityLabel={`Open the chat with ${contact.name}`}
                  onPress={() => openContact(contact)}
                />
              ))
            )}
          </View>
        </>
      )}
    </BottomSheet>
  );
}
