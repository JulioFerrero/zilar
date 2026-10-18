import { Effect, type Fiber } from 'effect';
import { useEffect, useMemo, useRef, useState } from 'react';

import { interruptFiber } from '@zilar/client-core';
import { topicsOfGroup } from '@/lib/topics';
import { useChatStore } from '@/store/chat-store-provider';

// How long a failed swipe keeps its line above the chat list.
const SWIPE_ERROR_MS = 4000;
const DELETE_ERROR = 'Could not delete. Try again.';

function withKey(keys: ReadonlySet<string>, key: string, on: boolean): ReadonlySet<string> {
  const next = new Set(keys);
  if (on) {
    next.add(key);
  } else {
    next.delete(key);
  }
  return next;
}

export function useChatActions() {
  const chats = useChatStore((state) => state.chats);
  // The chat id (or `group:<groupId>`) whose action sheet is open; the sheet resolves it to the rows below.
  const [actionFor, setActionFor] = useState<string | null>(null);
  const [actionMuteOpen, setActionMuteOpen] = useState(false);
  const [actionClearOpen, setActionClearOpen] = useState(false);
  const setChatPref = useChatStore((state) => state.setChatPref);
  const markChatRead = useChatStore((state) => state.markChatRead);
  const clearHistory = useChatStore((state) => state.clearHistory);
  const [actionError, setActionError] = useState('');
  // One timer clears the swipe-failure line; a new save or unmount cancels it.
  const swipeErrorTimer = useRef<Fiber.Fiber<unknown, unknown> | undefined>(undefined);
  const cancelSwipeErrorTimer = () => {
    interruptFiber(swipeErrorTimer.current);
    swipeErrorTimer.current = undefined;
  };
  useEffect(
    () => () => {
      interruptFiber(swipeErrorTimer.current);
    },
    [],
  );
  // One change per chat at a time: a second tap while it saves is dropped, other chats are not blocked.
  const prefInFlight = useRef(new Set<string>());
  const [prefBusy, setPrefBusy] = useState<ReadonlySet<string>>(() => new Set());

  const openActions = (id: string) => {
    setActionMuteOpen(false);
    setActionClearOpen(false);
    setActionError('');
    setActionFor(id);
  };

  // The rows behind the sheet: a group resolves to its General topic row. Only a General row enables the pref rows, since a group pref on any other JID would mute one topic, not the group.
  const actionContext = useMemo(() => {
    if (actionFor === null) {
      return undefined;
    }
    if (actionFor.startsWith('group:')) {
      const groupId = actionFor.slice('group:'.length);
      const topics = topicsOfGroup(chats, groupId);
      const general = topics.find((topic) => topic.topic?.isGeneral === true);
      const fallback = general ?? topics[0];
      const groupTitle = general?.groupTitle ?? fallback?.groupTitle ?? fallback?.title ?? 'Group';
      return { chat: general, groupId, groupTitle };
    }
    const chat = chats.find((entry) => entry.id === actionFor);
    return chat === undefined ? undefined : { chat, groupId: undefined, groupTitle: undefined };
  }, [actionFor, chats]);

  const actionChatId = actionContext?.chat?.id;
  const actionBusy = actionChatId !== undefined && prefBusy.has(actionChatId);
  // With no sheet open a save failure belongs to the swipe and shows on its own line; with the sheet open, the sheet shows it.
  const swipeError = actionFor === null ? actionError : '';

  // A saving chat change closes its sheet; a failure keeps it open. `save` is the write itself, so a pref patch, Mark as read and Clear history share one path; `errorText` is the fixed failure line.
  const runPrefSave = (
    chatId: string,
    save: () => Promise<void>,
    errorText = 'Could not save. Try again.',
  ) => {
    if (prefInFlight.current.has(chatId)) {
      return;
    }
    prefInFlight.current.add(chatId);
    setPrefBusy((busy) => withKey(busy, chatId, true));
    cancelSwipeErrorTimer();
    setActionError('');
    Effect.runFork(
      Effect.tryPromise({
        try: save,
        catch: (cause) => cause,
      }).pipe(
        Effect.tap(() =>
          Effect.sync(() => {
            setActionFor((current) => (current === chatId ? null : current));
            setActionMuteOpen(false);
            setActionClearOpen(false);
          }),
        ),
        Effect.catch(() =>
          Effect.sync(() => {
            setActionError(errorText);
            // A swipe has no sheet to show it in: keep the line for a beat.
            if (actionFor === null) {
              swipeErrorTimer.current = Effect.runFork(
                Effect.sleep(SWIPE_ERROR_MS).pipe(
                  Effect.andThen(Effect.sync(() => setActionError(''))),
                ),
              );
            }
          }),
        ),
        Effect.ensuring(
          Effect.sync(() => {
            prefInFlight.current.delete(chatId);
            setPrefBusy((busy) => withKey(busy, chatId, false));
          }),
        ),
      ),
    );
  };

  const saveChatPref = (chatId: string, input: Parameters<typeof setChatPref>[1]) => {
    runPrefSave(chatId, () => setChatPref(chatId, input));
  };

  // "Mark as unread" sets the manual pref; "Mark as read" runs the store action (recordRead plus clearing the pref).
  const markUnread = (chatId: string) =>
    runPrefSave(chatId, () => setChatPref(chatId, { unreadMark: true }));
  const markRead = (chatId: string) => runPrefSave(chatId, () => markChatRead(chatId));

  // Clear history runs the store action (my own copy only) and keeps the row; only `failed` shows the delete line.
  const clearHistoryFor = (chatId: string) => {
    setActionClearOpen(false);
    runPrefSave(
      chatId,
      () =>
        clearHistory(chatId).then((outcome) => {
          if (outcome === 'failed') {
            throw new Error('clear_history_failed');
          }
        }),
      DELETE_ERROR,
    );
  };

  const closeActions = () => {
    if (!actionBusy) {
      setActionFor(null);
      setActionMuteOpen(false);
      setActionClearOpen(false);
      setActionError('');
    }
  };

  return {
    actionContext,
    actionBusy,
    actionError,
    swipeError,
    actionMuteOpen,
    setActionMuteOpen,
    actionClearOpen,
    openClear: () => setActionClearOpen(true),
    closeClear: () => setActionClearOpen(false),
    openActions,
    closeActions,
    saveChatPref,
    markUnread,
    markRead,
    clearHistoryFor,
  };
}

export type ChatActions = ReturnType<typeof useChatActions>;
