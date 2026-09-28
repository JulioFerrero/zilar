import { Plus } from 'lucide-react';
import { useState } from 'react';
import { InviteDialog } from './InviteDialog';
import { NewAiDialog } from './ais/NewAiDialog';
import { NewGroupDialog } from './NewGroupDialog';
import { Button } from './ui/button';
import { useMediaQuery } from '@/lib/useMediaQuery';
import { cn } from '@/lib/utils';

const MENU_ITEM_CLASS =
  'flex w-full items-center px-3 py-2 text-left text-[15px] hover:bg-surface-raised focus-visible:bg-surface-raised focus-visible:outline-none';

type Dialog = 'group' | 'message' | 'invite' | 'ai';

/** New chat: a full-width primary key on wide screens, a primary FAB on narrow. */
export function NewChatButton() {
  const [menuOpen, setMenuOpen] = useState(false);
  const [dialog, setDialog] = useState<Dialog | undefined>(undefined);
  const isWide = useMediaQuery('(min-width: 900px)');

  const toggleMenu = (): void => setMenuOpen((value) => !value);

  const openDialog = (next: Dialog): void => {
    setMenuOpen(false);
    setDialog(next);
  };

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
            onClick={() => setMenuOpen(false)}
            className="fixed inset-0 z-10 cursor-default"
          />
          <div
            role="menu"
            aria-label="New chat actions"
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                setMenuOpen(false);
              }
            }}
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
          </div>
        </>
      )}

      {isWide ? (
        <Button
          type="button"
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
          aria-label="New chat"
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          onClick={toggleMenu}
          className="key-primary flex size-14 items-center justify-center rounded-[18px]"
        >
          <Plus className="size-[22px]" aria-hidden="true" />
        </button>
      )}

      {dialog === 'group' && <NewGroupDialog onClose={() => setDialog(undefined)} />}
      {dialog === 'ai' && <NewAiDialog onClose={() => setDialog(undefined)} />}
      {dialog === 'invite' && <InviteDialog onClose={() => setDialog(undefined)} />}
      {dialog === 'message' && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="New message"
          onClick={() => setDialog(undefined)}
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
