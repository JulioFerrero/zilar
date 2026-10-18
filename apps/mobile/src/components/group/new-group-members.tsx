import { Check } from 'lucide-react-native';
import { useMemo, useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';

import { ContactChip } from '@/components/contacts/contact-chip';
import { filterContacts } from '@/components/contacts/contact-presence';
import { EntityAvatar } from '@/components/chat/entity-avatar';
import { Card } from '@/components/ui/card';
import { SearchField } from '@/components/ui/search-field';
import { StateMessage } from '@/components/ui/state-message';
import { Text } from '@/components/ui/text';
import { ACCENT_FOREGROUND } from '@/lib/colors';
import { cn } from '@/lib/utils';
import type { Contact } from '@/lib/contacts-api';

/** The round selection circle the New group picker uses (Telegram's ticked circle). */
function SelectCircle({ checked }: { checked: boolean }) {
  return (
    <View
      className={cn(
        'h-6 w-6 items-center justify-center rounded-full border-2',
        checked ? 'border-accent bg-accent' : 'border-border-strong',
      )}
    >
      {checked ? <Check size={14} strokeWidth={3} color={ACCENT_FOREGROUND} /> : null}
    </View>
  );
}

export function NewGroupMembers({
  contacts,
  selected,
  onToggle,
}: {
  contacts: Contact[];
  selected: string[];
  onToggle: (userId: string) => void;
}) {
  const [query, setQuery] = useState('');
  const visible = useMemo(() => filterContacts(contacts, query), [contacts, query]);
  const picked = useMemo(
    () =>
      selected
        .map((userId) => contacts.find((contact) => contact.userId === userId))
        .filter((contact): contact is Contact => contact !== undefined),
    [contacts, selected],
  );

  return (
    <View className="flex-1">
      <View className="px-4 pt-3">
        <SearchField
          value={query}
          onChangeText={setQuery}
          onClear={() => setQuery('')}
          maxLength={100}
          placeholder="Search contacts"
          accessibilityLabel="Search contacts to add"
          autoCapitalize="none"
          autoCorrect={false}
        />
        {picked.length > 0 ? (
          <View className="mt-3 flex-row flex-wrap gap-2">
            {picked.map((person) => (
              <ContactChip
                key={person.userId}
                person={person}
                onRemove={() => onToggle(person.userId)}
              />
            ))}
          </View>
        ) : null}
      </View>

      <ScrollView
        className="flex-1"
        contentContainerStyle={{ paddingBottom: 32 }}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="interactive"
        automaticallyAdjustKeyboardInsets
      >
        <View className="p-4">
          {contacts.length === 0 ? (
            <StateMessage kind="empty" title="Invite a friend first to start a group." />
          ) : visible.length === 0 ? (
            <StateMessage kind="empty" title="No contacts match." />
          ) : (
            <View accessibilityRole="none" accessibilityLabel="Contacts to add">
              <Card>
                {visible.map((person) => {
                  const checked = selected.includes(person.userId);
                  return (
                    <Pressable
                      key={person.userId}
                      accessibilityRole="checkbox"
                      accessibilityState={{ checked }}
                      accessibilityLabel={person.name}
                      onPress={() => onToggle(person.userId)}
                      className="flex-row items-center gap-3 px-3 py-2.5 active:bg-surface-raised"
                    >
                      <EntityAvatar person={person} size={40} />
                      <View className="min-w-0 flex-1">
                        <Text numberOfLines={1} className="text-[15px] font-medium text-foreground">
                          {person.name}
                        </Text>
                        {person.handle !== undefined && person.handle !== null ? (
                          <Text numberOfLines={1} className="text-[13px] text-muted-foreground">
                            @{person.handle}
                          </Text>
                        ) : null}
                      </View>
                      <SelectCircle checked={checked} />
                    </Pressable>
                  );
                })}
              </Card>
            </View>
          )}
        </View>
      </ScrollView>
    </View>
  );
}
