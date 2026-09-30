import { Plus } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { InviteDialog } from './InviteDialog';
import { NewAiDialog } from './ais/NewAiDialog';
import { NewGroupDialog } from './NewGroupDialog';
import { NewTopicDialog } from './NewTopicDialog';
import { Button } from './ui/button';
import { useMediaQuery } from '@/lib/useMediaQuery';
import { useChatStore } from '@/store/ChatStoreProvider';
import { cn } from '@/lib/utils';

const MENU_ITEM_CLASS =
  'flex w-full items-center px-3 py-2 text-left text-[15px] hover:bg-surface-raised focus-visible:bg-surface-raised focus-visible:outline-none';

type Dialog = 'group' | 'channel' | 'message' | 'invite' | 'ai' | 'topic';

/** New chat: a full-width primary key on wide screens, a primary FAB on narrow. */
export function NewChatButton({ defaultGroupId }: { defaultGroupId?: string } = {}) {
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
  // (whose own keydown never reaches the menu). A document listener while the
  // menu is open covers both focus positions.
  useEffect(() => {
    if (!menuOpen) {
      return;
    }
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        setMenuOpen(false);
        focusTrigger();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [menuOpen]);

  // The inline "New message" dialog lives here, so Esc closes it and returns
  // focus to the trigger the same way the extracted dialogs do.
  useEffect(() => {
    if (dialog !== 'message') {
      return;
    }
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        setDialog(undefined);
        focusTrigger();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [dialog]);

  return (
    <div
      className={cn(
        'z-10',
        isWide ? 'relative shrink-0 border-t border-border p-3' : 'absolute right-4 bottom-4',
      )}
    >
      {menuOpen && (
        <>
          <button
            type="button"
            tabIndex={-1}
            aria-label="Close new chat menu"
            onClick={closeMenu}
            className="fixed inset-0 z-10 cursor-default"
          />
          <div
            role="menu"
            aria-label="New chat actions"
            className="absolute right-0 bottom-full z-20 mb-2 min-w-[180px] rounded-xl border border-border bg-popover py-1 shadow-lg"
          >
            <button
              type="button"
              role="menuitem"
              className={MENU_ITEM_CLASS}
              onClick={() => openDialog('group')}
            >
              New group
            </button>
            <button
              type="button"
              role="menuitem"
              className={MENU_ITEM_CLASS}
              onClick={() => openDialog('channel')}
            >
              New channel
            </button>
            <button
              type="button"
              role="menuitem"
              className={MENU_ITEM_CLASS}
              onClick={() => openDialog('message')}
            >
              New message
            </button>
            <button
              type="button"
              role="menuitem"
              className={MENU_ITEM_CLASS}
              onClick={() => openDialog('ai')}
            >
              New AI
            </button>
            {(defaultGroupId !== undefined || topicGroups.length > 0) && (
              <button
                type="button"
                role="menuitem"
                className={MENU_ITEM_CLASS}
                onClick={openNewTopic}
              >
                New topic
              </button>
            )}
          </div>
        </>
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
      {dialog === 'ai' && <NewAiDialog onClose={closeDialog} />}
      {dialog === 'invite' && <InviteDialog onClose={closeDialog} />}
      {dialog === 'topic' &&
        (topicGroupId !== undefined ? (
          <NewTopicDialog groupId={topicGroupId} onClose={closeDialog} />
        ) : (
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Choose a group"
            onClick={closeDialog}
            className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 p-4"
          >
            <div
              onClick={(event) => event.stopPropagation()}
              className="w-full max-w-xs rounded-2xl border border-border bg-panel p-4 shadow-xl"
            >
              <h2 className="text-[16px] font-semibold">New topic in…</h2>
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
            </div>
          </div>
        ))}
      {dialog === 'message' && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="New message"
          onClick={closeDialog}
          className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 p-4"
        >
          <div
            onClick={(event) => event.stopPropagation()}
            className="w-full max-w-xs rounded-2xl border border-border bg-panel p-4 shadow-xl"
          >
            <h2 className="text-[16px] font-semibold">New message</h2>
            <p className="mt-1 text-[15px] text-muted-foreground">
              Invite a friend to start a conversation.
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <Button
                type="button"
                onClick={() => openDialog('invite')}
                className="h-9 rounded-full px-4"
              >
                Invite a friend
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
