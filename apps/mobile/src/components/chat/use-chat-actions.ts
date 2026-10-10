import { Effect } from 'effect';
import { useMemo, useRef, useState } from 'react';

import { topicsOfGroup } from '@/lib/topics';
import { useChatStore } from '@/store/chat-store-provider';

// Returns a copy of `keys` with `key` added (on) or removed (off).
function withKey(keys: ReadonlySet<string>, key: string, on: boolean): ReadonlySet<string> {
  const next = new Set(keys);
  if (on) {
    next.add(key);
  } else {
    next.delete(key);
  }
  return next;
}

/**
 * The chats screen's action-sheet state and pref writes (T-0135): the
 * long-press actions on a chat or group row. `chat-actions-host.tsx` renders
 * the sheet from it; the screen passes `openActions` down to the rows.
 */
export function useChatActions() {
  const chats = useChatStore((state) => state.chats);
  // The chat id (or `group:<groupId>`) whose action sheet is open; the
  // sheet resolves it to the underlying rows below.
  const [actionFor, setActionFor] = useState<string | null>(null);
  const [actionMuteOpen, setActionMuteOpen] = useState(false);
  const setChatPref = useChatStore((state) => state.setChatPref);
  const [actionError, setActionError] = useState('');
  // One change per chat at a time (one action per row): a second tap on the
  // same chat while its change saves is dropped; other chats are not blocked.
  // The ref is read only in handlers; the state drives the busy display.
  const prefInFlight = useRef(new Set<string>());
  const [prefBusy, setPrefBusy] = useState<ReadonlySet<string>>(() => new Set());

  const openActions = (id: string) => {
    setActionMuteOpen(false);
    setActionError('');
    setActionFor(id);
  };

  // The rows behind the open action sheet: a group resolves to its General
  // topic row (the pref row a group mute/pin sits on). T-0139: only a
  // General row enables the pref rows — when General is absent (older
  // servers send no `topics`, or it is archived/filtered out) the sheet
  // still opens the group screen, but pin/mute/archive stay disabled, since
  // a group pref on a non-General JID would mute one topic, not the group.
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

  // A chat change that saves closes its sheet; a failure keeps it open with
  // the message.
  const saveChatPref = (chatId: string, input: Parameters<typeof setChatPref>[1]) => {
    if (prefInFlight.current.has(chatId)) {
      return;
    }
    prefInFlight.current.add(chatId);
    setPrefBusy((busy) => withKey(busy, chatId, true));
    setActionError('');
    Effect.runFork(
      Effect.tryPromise({
        try: () => setChatPref(chatId, input),
        catch: (cause) => cause,
      }).pipe(
        Effect.tap(() =>
          Effect.sync(() => {
            setActionFor((current) => (current === chatId ? null : current));
            setActionMuteOpen(false);
          }),
        ),
        Effect.catch(() =>
          Effect.sync(() => {
            setActionError('Could not save. Try again.');
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

  const closeActions = () => {
    if (!actionBusy) {
      setActionFor(null);
      setActionMuteOpen(false);
      setActionError('');
    }
  };

  return {
    actionContext,
    actionBusy,
    actionError,
    actionMuteOpen,
    setActionMuteOpen,
    openActions,
    closeActions,
    saveChatPref,
  };
}

export type ChatActions = ReturnType<typeof useChatActions>;
