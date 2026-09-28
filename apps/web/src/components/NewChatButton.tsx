import { Pencil } from 'lucide-react';
import { useState } from 'react';
import { InviteDialog } from './InviteDialog';
import { NewAiDialog } from './ais/NewAiDialog';
import { NewGroupDialog } from './NewGroupDialog';

const MENU_ITEM_CLASS =
  'flex w-full items-center px-3 py-2 text-left text-[15px] hover:bg-list-hover focus-visible:bg-list-hover focus-visible:outline-none';

type Dialog = 'group' | 'message' | 'invite' | 'ai';

/** Round pencil button at the bottom right of the chat list, with a small menu. */
export function NewChatButton() {
  const [menuOpen, setMenuOpen] = useState(false);
  const [dialog, setDialog] = useState<Dialog | undefined>(undefined);

  const openDialog = (next: Dialog): void => {
    setMenuOpen(false);
    setDialog(next);
  };

  return (
    <div className="absolute right-4 bottom-4 z-10">
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
            className="absolute right-0 bottom-full z-20 mb-2 min-w-[180px] rounded-xl border border-divider bg-popover py-1 shadow-lg"
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

      <button
        type="button"
        aria-label="New chat"
        aria-haspopup="menu"
        aria-expanded={menuOpen}
        onClick={() => setMenuOpen((value) => !value)}
        className="flex size-14 items-center justify-center rounded-full bg-accent text-accent-foreground shadow-lg transition-colors hover:bg-accent/90 focus-visible:ring-2 focus-visible:ring-accent/40 focus-visible:outline-none"
      >
        <Pencil className="size-5" aria-hidden="true" />
      </button>

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
            className="w-full max-w-xs rounded-2xl bg-background p-4 shadow-xl"
          >
            <h2 className="text-[16px] font-semibold">New message</h2>
            <p className="mt-1 text-[15px] text-muted-foreground">
              Invite a friend to start a conversation.
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => openDialog('invite')}
                className="rounded-full bg-accent px-4 py-1.5 text-[15px] font-medium text-accent-foreground hover:bg-accent/90"
              >
                Invite a friend
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
