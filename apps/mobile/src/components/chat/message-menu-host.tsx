import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';

import {
  BubbleActionsSheet,
  type BubbleActionsTarget,
} from '@/components/chat/message-bubble-actions';
import type { MessageHandler, ReactHandler } from '@/components/chat/use-stable-handlers';

// The list-level handlers the one sheet acts through: a bubble only names the message, the actions stay the list's.
type MessageMenuHandlers = {
  onReply: MessageHandler;
  onEdit: MessageHandler | undefined;
  onDelete: MessageHandler | undefined;
  onForward: MessageHandler | undefined;
  onStartSelect: MessageHandler | undefined;
  onPin: MessageHandler | undefined;
  onUnpin: MessageHandler | undefined;
  react: ReactHandler | undefined;
};

type MessageMenu = {
  open: (target: BubbleActionsTarget) => void;
};

const MessageMenuContext = createContext<MessageMenu | null>(null);

const ignoreReact: ReactHandler = () => {};

// One message menu per chat list, so a 50-row window no longer mounts ~100 native sheet views; the target outlives the close so content does not blank while the sheet animates away. The first press mounts it hidden and opens it a commit later, because a TrueSheet that mounts visible may never present.
export function MessageMenuHost({
  onReply,
  onEdit,
  onDelete,
  onForward,
  onStartSelect,
  onPin,
  onUnpin,
  react,
  children,
}: MessageMenuHandlers & { children: ReactNode }) {
  const [target, setTarget] = useState<BubbleActionsTarget | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  // Outside state, so `open` stays stable and a press reads the committed value without re-rendering every bubble.
  const menuVisible = useRef(false);
  // A press while the sheet is closing: `visible` is still true, so flipping it is a no-op and the new target would stay hidden; the next close presents it.
  const reopen = useRef(false);
  const setMenuVisible = useCallback((next: boolean) => {
    menuVisible.current = next;
    setMenuOpen(next);
  }, []);
  const open = useCallback(
    (next: BubbleActionsTarget) => {
      setTarget(next);
      setConfirmOpen(false);
      if (menuVisible.current) {
        // The dimmed backdrop blocks presses while presented, so a press now means the sheet is on its way out.
        reopen.current = true;
        return;
      }
      // Mount hidden, then open on the next frame, so TrueSheet has a mounted view to present.
      requestAnimationFrame(() => setMenuVisible(true));
    },
    [setMenuVisible],
  );
  const onMenuClosed = useCallback(() => {
    if (!reopen.current) {
      setMenuVisible(false);
      return;
    }
    reopen.current = false;
    // Leave `visible` false for a commit, then present the stored target, so ActionSheet sees the change it missed.
    setMenuVisible(false);
    requestAnimationFrame(() => setMenuVisible(true));
  }, [setMenuVisible]);
  const value = useMemo<MessageMenu>(() => ({ open }), [open]);
  return (
    <MessageMenuContext.Provider value={value}>
      {children}
      {target === null ? null : (
        <BubbleActionsSheet
          visible={menuOpen}
          confirmOpen={confirmOpen}
          {...target}
          onReply={onReply}
          onEdit={onEdit}
          onDelete={onDelete}
          onForward={onForward}
          onStartSelect={onStartSelect}
          onPin={onPin}
          onUnpin={onUnpin}
          react={react ?? ignoreReact}
          setMenuOpen={setMenuVisible}
          setConfirmOpen={setConfirmOpen}
          onMenuClosed={onMenuClosed}
        />
      )}
    </MessageMenuContext.Provider>
  );
}

export function useMessageMenu(): MessageMenu {
  const menu = useContext(MessageMenuContext);
  if (menu === null) {
    throw new Error('useMessageMenu must be used inside MessageMenuHost');
  }
  return menu;
}
