import { mutedUntilFor } from '@/lib/chat-prefs';

import { ChatActionsSheet } from './chat-actions-sheet';
import type { ChatActions } from './use-chat-actions';

/**
 * The long-press action sheet wired to the chats screen's action state
 * (T-0135). The hook holds the state and the pref writes; this host maps it
 * to the sheet's handlers.
 */
export function ChatActionsHost({
  actions,
  onOpenGroup,
}: {
  actions: ChatActions;
  onOpenGroup: (groupId: string) => void;
}) {
  const {
    actionContext,
    actionBusy,
    actionError,
    actionMuteOpen,
    setActionMuteOpen,
    actionClearOpen,
    openClear,
    closeClear,
    saveChatPref,
    markUnread,
    markRead,
    clearHistoryFor,
    closeActions,
  } = actions;
  return (
    <ChatActionsSheet
      chat={actionContext?.chat ?? null}
      groupTitle={actionContext?.groupTitle}
      groupId={actionContext?.groupId}
      busy={actionBusy}
      error={actionError}
      muteOpen={actionMuteOpen}
      clearOpen={actionClearOpen}
      onOpenMute={() => setActionMuteOpen(true)}
      onMute={(duration) =>
        actionContext?.chat === undefined
          ? undefined
          : saveChatPref(actionContext.chat.id, {
              mutedUntil: mutedUntilFor(duration, new Date()),
            })
      }
      onUnmute={() =>
        actionContext?.chat === undefined
          ? undefined
          : saveChatPref(actionContext.chat.id, { mutedUntil: null })
      }
      onTogglePin={() =>
        actionContext?.chat === undefined
          ? undefined
          : saveChatPref(actionContext.chat.id, {
              pinned: actionContext.chat.pinnedAt === undefined,
            })
      }
      onToggleArchive={() =>
        actionContext?.chat === undefined
          ? undefined
          : saveChatPref(actionContext.chat.id, {
              archived: actionContext.chat.archived !== true,
            })
      }
      onMarkUnread={() =>
        actionContext?.chat === undefined ? undefined : markUnread(actionContext.chat.id)
      }
      onMarkRead={() =>
        actionContext?.chat === undefined ? undefined : markRead(actionContext.chat.id)
      }
      onOpenClear={openClear}
      onClearHistory={() =>
        actionContext?.chat === undefined ? undefined : clearHistoryFor(actionContext.chat.id)
      }
      onCancelClear={closeClear}
      onOpenGroup={(groupId) => {
        closeActions();
        onOpenGroup(groupId);
      }}
      onClose={closeActions}
    />
  );
}
