import { useMemo, useState, type KeyboardEvent } from 'react';
import { useNavigate } from 'react-router';
import type { Contact } from '@zilar/api-contract';
import { useChatSelector } from '@/store/ChatStoreProvider';
import { cn } from '@/lib/utils';
import { EntityAvatar } from './EntityAvatar';
import { HandleSuffix } from './HandleSuffix';
import { Button } from './ui/button';
import { Dialog } from './ui/dialog';
import { SearchField } from './ui/search-field';

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

/** Picks one contact and opens the DM; the DM already exists on the server, so the list only catches up. */
export function NewMessageDialog({
  onClose,
  onInvite,
}: {
  onClose: () => void;
  onInvite: () => void;
}) {
  const contacts = useChatSelector((s) => s.contacts);
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const [activeId, setActiveId] = useState<string | undefined>(undefined);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return contacts.filter((contact) => matchesFilter(contact, needle));
  }, [contacts, query]);

  const openContact = (contact: Contact): void => {
    onClose();
    navigate(`/c/${encodeURIComponent(contact.jid)}`);
  };

  if (contacts.length === 0) {
    return (
      <Dialog
        open
        onClose={onClose}
        title="New message"
        description="Invite a friend to start a conversation, or type their @username in the search bar above."
        size="sm"
        footer={
          <Button type="button" onClick={onInvite} className="h-9 rounded-full px-4">
            Invite a friend
          </Button>
        }
      />
    );
  }

  const activeIndex = filtered.findIndex((contact) => contact.userId === activeId);
  const selectedIndex = activeIndex === -1 ? 0 : activeIndex;

  const move = (delta: number): void => {
    if (filtered.length === 0) {
      return;
    }
    const next = Math.min(Math.max(selectedIndex + delta, 0), filtered.length - 1);
    const contact = filtered[next];
    if (contact !== undefined) {
      setActiveId(contact.userId);
    }
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      move(1);
      return;
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      move(-1);
      return;
    }
    if (event.key === 'Enter') {
      const contact = filtered[selectedIndex];
      if (contact !== undefined) {
        event.preventDefault();
        openContact(contact);
      }
    }
  };

  return (
    <Dialog open onClose={onClose} title="New message" size="sm">
      <SearchField
        data-autofocus
        value={query}
        onChange={(event) => {
          setQuery(event.target.value);
          setActiveId(undefined);
        }}
        onKeyDown={onKeyDown}
        placeholder="Search contacts"
        aria-label="Search contacts"
        className="mt-3"
      />
      <div className="mt-2">
        {filtered.length === 0 ? (
          <p className="py-6 text-center text-[14px] text-muted-foreground">No contacts found</p>
        ) : (
          filtered.map((contact, index) => (
            <button
              key={contact.userId}
              type="button"
              onMouseEnter={() => setActiveId(contact.userId)}
              onClick={() => openContact(contact)}
              className={cn(
                'flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left',
                index === selectedIndex ? 'bg-surface-raised' : 'hover:bg-list-hover',
              )}
            >
              <EntityAvatar person={contact} size={28} />
              <span className="truncate text-[15px]">
                {contact.name} <HandleSuffix handle={contact.handle} />
              </span>
            </button>
          ))
        )}
      </div>
    </Dialog>
  );
}
