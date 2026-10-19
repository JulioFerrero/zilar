import type { Contact } from '@zilar/api-contract';
import { mayCreateTopic } from '@zilar/chat-core';
import { Bot, Compass, Hash, Megaphone, MessageSquarePlus, Plus, Users } from 'lucide-react';
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react';
import { useNavigate } from 'react-router';
import { EntityAvatar } from './EntityAvatar';
import { HandleSuffix } from './HandleSuffix';
import { InviteDialog } from './InviteDialog';
import { NewAiDialog } from './ais/NewAiDialog';
import { NewGroupDialog } from './NewGroupDialog';
import { NewTopicDialog } from './NewTopicDialog';
import { Button } from './ui/button';
import { Dialog } from './ui/dialog';
import { Menu, MenuItem } from './ui/menu';
import { SearchField } from './ui/search-field';
import { useMediaQuery } from '@/lib/useMediaQuery';
import { useChatSelector } from '@/store/ChatStoreProvider';
import { cn } from '@/lib/utils';

type Dialog = 'group' | 'channel' | 'message' | 'invite' | 'ai' | 'topic';

export function NewChatButton({
  defaultGroupId,
  onExplore,
}: {
  defaultGroupId?: string;
  onExplore?: () => void;
} = {}) {
  const navigate = useNavigate();
  const [menuOpen, setMenuOpen] = useState(false);
  const [dialog, setDialog] = useState<Dialog | undefined>(undefined);
  const [topicGroupId, setTopicGroupId] = useState<string | undefined>(undefined);
  const isWide = useMediaQuery('(min-width: 900px)');
  const triggerRef = useRef<HTMLButtonElement>(null);
  const chats = useChatSelector((s) => s.chats);
  const currentUserId = useChatSelector((s) => s.currentUserId);
  const groupInfos = useChatSelector((s) => s.groupInfos);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'n' && event.key !== 'N') {
        return;
      }
      if (event.metaKey || event.ctrlKey || event.altKey) {
        return;
      }
      const target = event.target;
      if (
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        (target instanceof HTMLElement && target.isContentEditable)
      ) {
        return;
      }
      event.preventDefault();
      setMenuOpen((value) => !value);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const focusTrigger = (): void => triggerRef.current?.focus();

  const closeDialog = (): void => {
    setDialog(undefined);
    focusTrigger();
  };

  const openDialog = (next: Dialog): void => {
    setMenuOpen(false);
    setDialog(next);
  };

  const openExplore = (): void => {
    setMenuOpen(false);
    if (onExplore !== undefined) {
      onExplore();
    } else {
      navigate('/explore');
    }
  };

  // Groups the viewer may create a topic in; the entry is absent when none qualifies.
  const topicGroups = useMemo(() => {
    const mine = currentUserId;
    const seen = new Map<string, { chatId: string; title: string }>();
    for (const chat of chats) {
      if (chat.groupId === undefined) {
        continue;
      }
      if (seen.has(chat.groupId)) {
        continue;
      }
      const info = groupInfos[chat.id];
      const role = info?.members.find((member) => member.userId === mine)?.role;
      const mayCreate =
        info !== undefined &&
        mayCreateTopic({
          members: info.members,
          meUserId: mine,
          membersCanCreateTopics: info.membersCanCreateTopics === true,
        });
      // The detail may not be loaded yet; the dialog's create call enforces the real permission.
      if (role === undefined) {
        seen.set(chat.groupId, {
          chatId: chat.id,
          title: chat.groupTitle ?? chat.title,
        });
      } else if (mayCreate) {
        seen.set(chat.groupId, {
          chatId: chat.id,
          title: info?.title ?? chat.groupTitle ?? chat.title,
        });
      }
    }
    return [...seen.values()];
  }, [chats, currentUserId, groupInfos]);

  const openNewTopic = (): void => {
    setMenuOpen(false);
    if (defaultGroupId !== undefined) {
      setTopicGroupId(defaultGroupId);
      setDialog('topic');
      return;
    }
    if (topicGroups.length === 1 && topicGroups[0] !== undefined) {
      setTopicGroupId(topicGroups[0].chatId);
      setDialog('topic');
      return;
    }
    if (topicGroups.length > 1) {
      setTopicGroupId(undefined);
      setDialog('topic');
      return;
    }
    setTopicGroupId(undefined);
    setDialog('topic');
  };

  return (
    <div
      className={cn(
        'z-10',
        isWide ? 'relative shrink-0 border-t border-border p-3' : 'absolute right-4 bottom-4',
      )}
    >
      <Menu
        open={menuOpen}
        onOpenChange={setMenuOpen}
        label="New chat actions"
        side="top"
        align="end"
        sideOffset={8}
        trigger={
          isWide ? (
            <Button
              type="button"
              ref={triggerRef}
              aria-label="New chat"
              className="h-10 w-full gap-2 rounded-[10px] text-[14px] font-semibold"
            >
              <Plus aria-hidden="true" />
              New chat
              <kbd className="font-mono rounded-[5px] border border-current px-1 text-[11px] leading-4 opacity-60">
                N
              </kbd>
            </Button>
          ) : (
            <Button
              ref={triggerRef}
              type="button"
              size="icon-lg"
              aria-label="New chat"
              className="size-14 rounded-[18px]"
            >
              <Plus className="size-[22px]" aria-hidden="true" />
            </Button>
          )
        }
      >
        <MenuItem icon={Users} onSelect={() => openDialog('group')}>
          New group
        </MenuItem>
        <MenuItem icon={Megaphone} onSelect={() => openDialog('channel')}>
          New channel
        </MenuItem>
        <MenuItem icon={Compass} onSelect={openExplore}>
          Explore groups
        </MenuItem>
        <MenuItem icon={MessageSquarePlus} onSelect={() => openDialog('message')}>
          New message
        </MenuItem>
        <MenuItem icon={Bot} onSelect={() => openDialog('ai')}>
          New AI
        </MenuItem>
        {(defaultGroupId !== undefined || topicGroups.length > 0) && (
          <MenuItem icon={Hash} onSelect={openNewTopic}>
            New topic
          </MenuItem>
        )}
      </Menu>

      {dialog === 'group' && <NewGroupDialog onClose={closeDialog} />}
      {dialog === 'channel' && <NewGroupDialog onClose={closeDialog} channel />}
      {dialog === 'ai' && <NewAiDialog onClose={closeDialog} />}
      {dialog === 'invite' && <InviteDialog onClose={closeDialog} />}
      {dialog === 'topic' &&
        (topicGroupId !== undefined ? (
          <NewTopicDialog groupId={topicGroupId} onClose={closeDialog} />
        ) : (
          <Dialog
            open
            onClose={closeDialog}
            title="New topic in…"
            ariaLabel="Choose a group"
            size="sm"
          >
            <div className="mt-3 flex flex-col gap-1">
              {topicGroups.map((group) => (
                <button
                  key={group.chatId}
                  type="button"
                  onClick={() => {
                    setTopicGroupId(group.chatId);
                    setDialog('topic');
                  }}
                  className="rounded-xl px-3 py-2 text-left text-[15px] hover:bg-surface-raised focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
                >
                  {group.title}
                </button>
              ))}
            </div>
          </Dialog>
        ))}
      {dialog === 'message' && (
        <NewMessageDialog onClose={closeDialog} onInvite={() => openDialog('invite')} />
      )}
    </div>
  );
}

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
function NewMessageDialog({ onClose, onInvite }: { onClose: () => void; onInvite: () => void }) {
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

  const onKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>): void => {
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
