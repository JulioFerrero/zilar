import { Plus } from 'lucide-react';
import { useMemo, useRef, useState } from 'react';
import { ExplorePage } from './ExplorePage';
import { InviteDialog } from './InviteDialog';
import { NewAiDialog } from './ais/NewAiDialog';
import { NewGroupDialog } from './NewGroupDialog';
import { NewTopicDialog } from './NewTopicDialog';
import { Button } from './ui/button';
import { Dialog } from './ui/dialog';
import { Menu, MenuItem } from './ui/menu';
import { useMediaQuery } from '@/lib/useMediaQuery';
import { useChatStore } from '@/store/ChatStoreProvider';
import { cn } from '@/lib/utils';

type Dialog = 'group' | 'channel' | 'message' | 'invite' | 'ai' | 'topic' | 'explore';

/** New chat: a full-width primary key on wide screens, a primary FAB on narrow. */
export function NewChatButton({
  defaultGroupId,
  onExplore,
}: {
  defaultGroupId?: string;
  // T-0164: reaching the Explore directory from the + new chat menu. When
  // provided, the menu entry delegates to the owner (ChatList's overlay);
  // otherwise the button renders its own overlay.
  onExplore?: () => void;
} = {}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [dialog, setDialog] = useState<Dialog | undefined>(undefined);
  // "New topic" from a group header pre-selects that group; the menu asks
  // which group when several can take a topic.
  const [topicGroupId, setTopicGroupId] = useState<string | undefined>(undefined);
  const isWide = useMediaQuery('(min-width: 900px)');
  const triggerRef = useRef<HTMLButtonElement>(null);
  const store = useChatStore();

  const toggleMenu = (): void => setMenuOpen((value) => !value);

  const focusTrigger = (): void => triggerRef.current?.focus();

  const closeMenu = (): void => {
    setMenuOpen(false);
    focusTrigger();
  };

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
      setDialog('explore');
    }
  };

  // Groups the viewer may create a topic in: owner/admin always, members
  // when the group allows it. The menu entry is absent (not disabled) when
  // no group qualifies.
  const topicGroups = useMemo(() => {
    const mine = store.currentUserId;
    const seen = new Map<string, { chatId: string; title: string }>();
    for (const chat of store.chats) {
      if (chat.groupId === undefined) {
        continue;
      }
      if (seen.has(chat.groupId)) {
        continue;
      }
      const info = store.groupInfo(chat.id);
      const role = info?.members.find((member) => member.userId === mine)?.role;
      const mayCreate =
        role === 'owner' ||
        role === 'admin' ||
        (role === 'member' && info?.membersCanCreateTopics === true);
      // The detail may not have loaded yet: fall back to showing the entry
      // when any non-topic group row exists — the dialog's create call
      // enforces the real permission and reports the failure.
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
  }, [store]);

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

  // Esc must close the menu wherever focus is, including on the trigger button
  // (whose own keydown never reaches the menu). `Menu` registers a document
  // listener while open that closes and returns focus to the trigger.

  return (
    <div
      className={cn(
        'z-10',
        isWide ? 'relative shrink-0 border-t border-border p-3' : 'absolute right-4 bottom-4',
      )}
    >
      {menuOpen && (
        <Menu
          open={menuOpen}
          onClose={closeMenu}
          label="New chat actions"
          closeLabel="Close new chat menu"
          className="right-0 bottom-full mb-2"
        >
          <MenuItem onSelect={() => openDialog('group')}>New group</MenuItem>
          <MenuItem onSelect={() => openDialog('channel')}>New channel</MenuItem>
          <MenuItem onSelect={openExplore}>Explore groups</MenuItem>
          <MenuItem onSelect={() => openDialog('message')}>New message</MenuItem>
          <MenuItem onSelect={() => openDialog('ai')}>New AI</MenuItem>
          {(defaultGroupId !== undefined || topicGroups.length > 0) && (
            <MenuItem onSelect={openNewTopic}>New topic</MenuItem>
          )}
        </Menu>
      )}

      {isWide ? (
        <Button
          type="button"
          ref={triggerRef}
          aria-label="New chat"
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          onClick={toggleMenu}
          className="h-10 w-full gap-2 rounded-[10px] text-[14px] font-semibold"
        >
          <Plus aria-hidden="true" />
          New chat
          <kbd className="font-mono rounded-[5px] border border-current px-1 text-[11px] leading-4 opacity-60">
            N
          </kbd>
        </Button>
      ) : (
        <button
          type="button"
          ref={triggerRef}
          aria-label="New chat"
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          onClick={toggleMenu}
          className="key-primary flex size-14 items-center justify-center rounded-[18px]"
        >
          <Plus className="size-[22px]" aria-hidden="true" />
        </button>
      )}

      {dialog === 'group' && <NewGroupDialog onClose={closeDialog} />}
      {dialog === 'channel' && <NewGroupDialog onClose={closeDialog} channel />}
      {dialog === 'explore' && <ExplorePage onClose={closeDialog} />}
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
        <Dialog
          open
          onClose={closeDialog}
          title="New message"
          description="Invite a friend to start a conversation, or type their @username in the search bar above."
          size="sm"
          actions={
            <>
              <Button
                type="button"
                variant="outline"
                onClick={closeDialog}
                className="h-9 rounded-full px-4"
              >
                Close
              </Button>
              <Button
                type="button"
                onClick={() => openDialog('invite')}
                className="h-9 rounded-full px-4"
              >
                Invite a friend
              </Button>
            </>
          }
        />
      )}
    </div>
  );
}
