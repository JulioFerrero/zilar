import { useMemo, useState } from 'react';
import type { Contact } from '@/lib/api';
import { EntityAvatar } from './EntityAvatar';
import { HandleSuffix } from './HandleSuffix';
import { Checkbox } from './ui/checkbox';
import { SearchField } from './ui/search-field';

/**
 * WUX-20: the "Add members" step of `NewGroupDialog`. A search box filters the
 * contact list by name or handle. Selection is controlled by the dialog, so
 * the chosen ids survive the search text changing or the list unmounting.
 */
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
  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (needle === '') {
      return contacts;
    }
    return contacts.filter(
      (contact) =>
        contact.name.toLowerCase().includes(needle) ||
        (contact.handle ?? '').toLowerCase().includes(needle),
    );
  }, [contacts, query]);

  return (
    <div className="mt-3">
      {contacts.length > 0 && (
        <div className="mb-2">
          <SearchField
            autoFocus
            value={query}
            placeholder="Search contacts"
            aria-label="Search contacts"
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>
      )}
      {filtered.length === 0 ? (
        <p className="py-6 text-center text-[14px] text-muted-foreground">
          {contacts.length === 0 ? 'Invite a friend first to start a group.' : 'No contacts match'}
        </p>
      ) : (
        filtered.map((contact) => (
          <label
            key={contact.userId}
            className="flex cursor-pointer items-center gap-3 rounded-lg px-2 py-2 hover:bg-list-hover"
          >
            <Checkbox
              checked={selected.includes(contact.userId)}
              onCheckedChange={() => onToggle(contact.userId)}
            />
            <EntityAvatar person={contact} size={28} />
            <span className="truncate text-[15px]">
              {contact.name} <HandleSuffix handle={contact.handle} />
            </span>
          </label>
        ))
      )}
    </div>
  );
}
