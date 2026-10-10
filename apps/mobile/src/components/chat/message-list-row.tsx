import type { ChatSummary, MessageItem, UiMessage } from '@zilar/chat-core';

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

export function MessageListRow({
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
