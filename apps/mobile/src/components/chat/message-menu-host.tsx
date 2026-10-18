import type { UiMessage, UiReaction } from '@zilar/chat-core';
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';

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
  const open = useCallback((next: MessageMenuTarget) => {
    setTarget(next);
    setConfirmOpen(false);
    setMenuOpen(true);
  }, []);
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
          setMenuOpen={setMenuOpen}
          setConfirmOpen={setConfirmOpen}
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
