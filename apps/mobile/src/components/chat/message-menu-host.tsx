import type { UiMessage, UiReaction } from '@zilar/chat-core';
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';

import { BubbleActionsSheet } from '@/components/chat/message-bubble-actions';
import type { MessageHandler, ReactHandler } from '@/components/chat/use-stable-handlers';

/** Everything a bubble hands over when its long-press opens the list's menu. */
export type MessageMenuTarget = {
  message: UiMessage;
  /** T-1274: an album's members, so Delete acts on the whole album. */
  albumMembers: UiMessage[] | undefined;
  canCopy: boolean;
  canEdit: boolean;
  canDelete: boolean;
  /** T-1247: any deletable DM message, including the peer's. */
  canDeleteForMe: boolean;
  /** T-1247: a DM (not a group or AI chat). */
  isDm: boolean;
  /** T-1247: this message is my own. */
  own: boolean;
  /** T-1247: the sender's name, for the DM confirm body. */
  senderName: string;
  canForward: boolean;
  canPin: boolean | undefined;
  isPinned: boolean | undefined;
  myReactions: UiReaction[];
};

/**
 * The list-level handlers the one sheet acts through. A bubble only names the
 * message it opened on; the actions stay the list's.
 */
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
  open: (target: MessageMenuTarget) => void;
};

const MessageMenuContext = createContext<MessageMenu | null>(null);

const ignoreReact: ReactHandler = () => {};

/**
 * One message menu per chat list (T-2018, W3a). Before this, every mounted row
 * owned a `BubbleActionsSheet`: a native TrueSheet plus a delete confirm, so a
 * 50-row window mounted about 100 native sheet views. The bubbles now name
 * their target through `useMessageMenu`, and this host draws the only sheet.
 * The target outlives the close, so the content does not blank while the sheet
 * animates away.
 *
 * The first press mounts the sheet with `visible={false}` and opens it in a
 * later commit (T-2026): a native TrueSheet that mounts already visible may
 * never present, because its view is not attached yet when `present()` runs.
 * A press that lands while the sheet is closing flips nothing, so the host
 * remembers it and presents its target once the sheet reports the close.
 */
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
  const [target, setTarget] = useState<MessageMenuTarget | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  // The same flag outside state, so `open` stays stable and a press can read the
  // committed value without re-rendering every bubble on each open or close.
  const menuVisible = useRef(false);
  // A press that lands while the sheet is closing: `visible` is still true, so
  // flipping it is a no-op, and the in-flight dismissal then leaves the new
  // target hidden. The next close presents that target instead.
  const reopen = useRef(false);
  const setMenuVisible = useCallback((next: boolean) => {
    menuVisible.current = next;
    setMenuOpen(next);
  }, []);
  const open = useCallback(
    (next: MessageMenuTarget) => {
      setTarget(next);
      setConfirmOpen(false);
      if (menuVisible.current) {
        // The dimmed backdrop blocks presses while the sheet is presented, so a
        // press now means the sheet is already on its way out.
        reopen.current = true;
        return;
      }
      // The sheet mounts in this commit; opening it on the next frame gives
      // TrueSheet a mounted view to present. A sheet mounted already visible
      // may never present.
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
    // Leave `visible` false for a commit, then present the target the press
    // stored, so ActionSheet sees the change it missed while closing.
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

/** The list's one message menu; a bubble calls `open` on a long-press. */
export function useMessageMenu(): MessageMenu {
  const menu = useContext(MessageMenuContext);
  if (menu === null) {
    throw new Error('useMessageMenu must be used inside MessageMenuHost');
  }
  return menu;
}
