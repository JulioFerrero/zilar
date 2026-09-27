import { Pencil } from 'lucide-react';
import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { cn } from '@/lib/utils';

type NewChatAction = 'group' | 'message';

const MENU_ITEM_CLASS =
  'flex w-full items-center px-3 py-2 text-left text-[15px] hover:bg-list-hover focus-visible:bg-list-hover focus-visible:outline-none';

/** Round pencil button at the bottom right of the chat list, with a small menu. */
export function NewChatButton() {
  const [menuOpen, setMenuOpen] = useState(false);
  const [action, setAction] = useState<NewChatAction | undefined>(undefined);
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (action !== undefined) {
      closeButtonRef.current?.focus();
    }
  }, [action]);

  const openDialog = (next: NewChatAction): void => {
    setMenuOpen(false);
    setAction(next);
  };

  const onEscape = (close: () => void) => (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      event.stopPropagation();
      close();
    }
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
            onKeyDown={onEscape(() => setMenuOpen(false))}
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

      {action !== undefined && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={action === 'group' ? 'New group' : 'New message'}
          onKeyDown={onEscape(() => setAction(undefined))}
          onClick={() => setAction(undefined)}
          className="fixed inset-0 z-30 flex items-center justify-center bg-black/40 p-4"
        >
          <div
            onClick={(event) => event.stopPropagation()}
            className="w-full max-w-xs rounded-2xl bg-background p-4 shadow-xl"
          >
            <h2 className="text-[16px] font-semibold">
              {action === 'group' ? 'New group' : 'New message'}
            </h2>
            <p className="mt-1 text-[15px] text-muted-foreground">Coming soon</p>
            <div className="mt-4 flex justify-end">
              <button
                ref={closeButtonRef}
                type="button"
                onClick={() => setAction(undefined)}
                className={cn(
                  'rounded-full bg-accent px-4 py-1.5 text-[15px] font-medium text-accent-foreground',
                  'hover:bg-accent/90 focus-visible:ring-2 focus-visible:ring-accent/40 focus-visible:outline-none',
                )}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
