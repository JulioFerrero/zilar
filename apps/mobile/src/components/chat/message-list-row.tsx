import type { ChatSummary, MessageItem, UiMessage } from '@zilar/chat-core';
import { memo } from 'react';

import { DateSeparator } from '@/components/chat/date-separator';
import { MessageBubble } from '@/components/chat/message-bubble';
import { UnreadDivider } from '@/components/chat/unread-divider';
import type { MessageHandler, ReactHandler } from '@/components/chat/use-stable-handlers';
import type { VoicePlayerHost } from '@/components/chat/voice-player';

export type ListEntry =
  | { type: 'divider'; key: string }
  | { type: 'separator'; key: string; date: Date }
  | {
      type: 'message';
      key: string;
      item: MessageItem;
      isDraft: boolean;
      revealTurnId: string | undefined;
    };

type MessageListSelection = {
  ids: readonly string[];
  onToggle: (message: UiMessage) => void;
  onStart: (message: UiMessage) => void;
};

type MessageListRowProps = {
  item: ListEntry;
  chat: ChatSummary;
  currentUserId: string;
  canPinChat: boolean;
  pinnedIds: readonly string[];
  openingAttachmentId: string | undefined;
  voiceHost: VoicePlayerHost | undefined;
  selection: MessageListSelection | undefined;
  onReply: MessageHandler;
  onReact: ReactHandler | undefined;
  onEdit: MessageHandler | undefined;
  onDelete: MessageHandler | undefined;
  onForward: MessageHandler | undefined;
  onPin: MessageHandler | undefined;
  onUnpin: MessageHandler | undefined;
  onRetrySticker: MessageHandler | undefined;
  onRetryAttachment: MessageHandler | undefined;
  onCancelAttachment: MessageHandler | undefined;
  onRetryVoice: MessageHandler | undefined;
  onCancelVoice: MessageHandler | undefined;
  onOpenAttachment: MessageHandler | undefined;
  onToggleSelect: MessageHandler | undefined;
  onStartSelect: MessageHandler | undefined;
};

function MessageListRowImpl({
  item,
  chat,
  currentUserId,
  canPinChat,
  pinnedIds,
  openingAttachmentId,
  voiceHost,
  selection,
  onReply,
  onReact,
  onEdit,
  onDelete,
  onForward,
  onPin,
  onUnpin,
  onRetrySticker,
  onRetryAttachment,
  onCancelAttachment,
  onRetryVoice,
  onCancelVoice,
  onOpenAttachment,
  onToggleSelect,
  onStartSelect,
}: MessageListRowProps) {
  if (item.type === 'divider') {
    return <UnreadDivider />;
  }
  if (item.type === 'separator') {
    return <DateSeparator date={item.date} />;
  }
  return (
    <MessageBubble
      message={item.item.message}
      isGroup={chat.kind === 'group'}
      isFirstInGroup={item.item.firstInGroup}
      isLastInGroup={item.item.lastInGroup}
      currentUserId={currentUserId}
      onReply={onReply}
      {...(onReact === undefined ? {} : { onReact })}
      {...(onEdit === undefined ? {} : { onEdit })}
      {...(onDelete === undefined ? {} : { onDelete })}
      {...(onForward === undefined ? {} : { onForward })}
      canPin={canPinChat}
      isPinned={pinnedIds.includes(item.item.message.id)}
      {...(onPin === undefined ? {} : { onPin })}
      {...(onUnpin === undefined ? {} : { onUnpin })}
      draft={item.isDraft}
      revealTurnId={item.revealTurnId}
      {...(onRetrySticker === undefined ? {} : { onRetrySticker })}
      {...(onRetryAttachment === undefined ? {} : { onRetryAttachment })}
      {...(onCancelAttachment === undefined ? {} : { onCancelAttachment })}
      {...(onRetryVoice === undefined ? {} : { onRetryVoice })}
      {...(onCancelVoice === undefined ? {} : { onCancelVoice })}
      {...(onOpenAttachment === undefined ? {} : { onOpenAttachment })}
      {...(openingAttachmentId === undefined ? {} : { openingAttachmentId })}
      {...(voiceHost === undefined ? {} : { voiceHost })}
      selecting={selection !== undefined && selection.ids.length > 0}
      selected={selection !== undefined && selection.ids.includes(item.item.message.id)}
      {...(onToggleSelect === undefined ? {} : { onToggleSelect })}
      {...(onStartSelect === undefined ? {} : { onStartSelect })}
    />
  );
}

/** Whether two list entries would render the same row. */
function isSameEntry(a: ListEntry, b: ListEntry): boolean {
  if (a === b) {
    return true;
  }
  if (a.type !== b.type || a.key !== b.key) {
    return false;
  }
  if (a.type === 'separator' && b.type === 'separator') {
    return a.date.getTime() === b.date.getTime();
  }
  if (a.type === 'message' && b.type === 'message') {
    return (
      a.item.message === b.item.message &&
      a.item.firstInGroup === b.item.firstInGroup &&
      a.item.lastInGroup === b.item.lastInGroup &&
      a.isDraft === b.isDraft &&
      a.revealTurnId === b.revealTurnId
    );
  }
  return true;
}

/**
 * Whether the row can skip a render. `item` is rebuilt by `groupMessages` on
 * every list rebuild (a draft frame is one every ~150 ms) even when the row did
 * not change, so it is compared field by field; every other prop is compared by
 * identity and the list keeps those stable via `useCallback`/`useStableHandler`.
 */
function areRowPropsEqual(prev: MessageListRowProps, next: MessageListRowProps): boolean {
  return (
    isSameEntry(prev.item, next.item) &&
    prev.chat === next.chat &&
    prev.currentUserId === next.currentUserId &&
    prev.canPinChat === next.canPinChat &&
    prev.pinnedIds === next.pinnedIds &&
    prev.openingAttachmentId === next.openingAttachmentId &&
    prev.voiceHost === next.voiceHost &&
    prev.selection === next.selection &&
    prev.onReply === next.onReply &&
    prev.onReact === next.onReact &&
    prev.onEdit === next.onEdit &&
    prev.onDelete === next.onDelete &&
    prev.onForward === next.onForward &&
    prev.onPin === next.onPin &&
    prev.onUnpin === next.onUnpin &&
    prev.onRetrySticker === next.onRetrySticker &&
    prev.onRetryAttachment === next.onRetryAttachment &&
    prev.onCancelAttachment === next.onCancelAttachment &&
    prev.onRetryVoice === next.onRetryVoice &&
    prev.onCancelVoice === next.onCancelVoice &&
    prev.onOpenAttachment === next.onOpenAttachment &&
    prev.onToggleSelect === next.onToggleSelect &&
    prev.onStartSelect === next.onStartSelect
  );
}

/**
 * Memoised (T-1188): with the list's stable handlers, a store tick such as a
 * draft frame only re-renders the row whose entry changed, not every loaded row.
 */
export const MessageListRow = memo(MessageListRowImpl, areRowPropsEqual);
