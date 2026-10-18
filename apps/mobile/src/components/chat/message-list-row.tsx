import {
  type AlbumItem,
  type MessageItem,
  type UiMessage,
  formatDateSeparator,
} from '@zilar/chat-core';
import { memo } from 'react';
import { AlbumMembersProvider } from '@/components/chat/album-members';
import { MessageBubble } from '@/components/chat/message-bubble';
import type { MessageHandler, ReactHandler } from '@/components/chat/use-stable-handlers';
import type { VoicePlayerHost } from '@/components/chat/voice-player-host';
import { View } from 'react-native';
import { Text } from '@/components/ui/text';
import { well, raisedPill } from '@/lib/depth';

function DateSeparator({ date }: { date: Date }) {
  return (
    <View className="my-2 items-center">
      <View className="rounded-full px-2.5 py-1" style={raisedPill}>
        <Text className="text-[12px] font-medium text-muted-foreground">
          {formatDateSeparator(date, new Date())}
        </Text>
      </View>
    </View>
  );
}

function UnreadDivider() {
  return (
    <View className="my-3 w-full px-3">
      <View className="w-full rounded-[10px] px-3 py-1.5" style={well}>
        <Text className="text-center text-[12px] font-medium text-muted-foreground">
          Unread messages
        </Text>
      </View>
    </View>
  );
}

export type ListEntry =
  | { type: 'divider'; key: string }
  | { type: 'separator'; key: string; date: Date }
  | {
      type: 'message';
      key: string;
      item: MessageItem | AlbumItem;
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
  isGroup: boolean;
  currentUserId: string;
  canPinChat: boolean;
  pinnedIds: readonly string[];
  openingAttachmentId: string | undefined;
  voiceHost: VoicePlayerHost | undefined;
  selection: MessageListSelection | undefined;
  onReply: MessageHandler;
  onReact: ReactHandler | undefined;
  onForward: MessageHandler | undefined;
  onRetrySticker: MessageHandler | undefined;
  onRetryAttachment: MessageHandler | undefined;
  onCancelAttachment: MessageHandler | undefined;
  onRetryVoice: MessageHandler | undefined;
  onCancelVoice: MessageHandler | undefined;
  onOpenAttachment: MessageHandler | undefined;
  onToggleSelect: MessageHandler | undefined;
};

function MessageListRowImpl({
  item,
  isGroup,
  currentUserId,
  canPinChat,
  pinnedIds,
  openingAttachmentId,
  voiceHost,
  selection,
  onReply,
  onReact,
  onForward,
  onRetrySticker,
  onRetryAttachment,
  onCancelAttachment,
  onRetryVoice,
  onCancelVoice,
  onOpenAttachment,
  onToggleSelect,
}: MessageListRowProps) {
  if (item.type === 'divider') {
    return <UnreadDivider />;
  }
  if (item.type === 'separator') {
    return <DateSeparator date={item.date} />;
  }
  // An album item renders its head bubble; the grid inside its attachment body draws exactly this run, so a colliding id or a far sibling cannot merge in.
  const albumMembers = item.item.kind === 'album' ? item.item.messages : null;
  return (
    <AlbumMembersProvider messages={albumMembers}>
      <MessageBubble
        message={item.item.message}
        isGroup={isGroup}
        isFirstInGroup={item.item.firstInGroup}
        isLastInGroup={item.item.lastInGroup}
        currentUserId={currentUserId}
        onReply={onReply}
        {...(onReact === undefined ? {} : { onReact })}
        {...(onForward === undefined ? {} : { onForward })}
        canPin={canPinChat}
        isPinned={pinnedIds.includes(item.item.message.id)}
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
      />
    </AlbumMembersProvider>
  );
}

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
      sameAlbumMembers(a.item, b.item) &&
      a.isDraft === b.isDraft &&
      a.revealTurnId === b.revealTurnId
    );
  }
  return true;
}

// Whether two entries carry the same album members; compared element by element because `groupMessages` rebuilds the array on every rebuild, and a sibling from an older page must re-render the grid.
function sameAlbumMembers(a: MessageItem | AlbumItem, b: MessageItem | AlbumItem): boolean {
  const aMembers = a.kind === 'album' ? a.messages : null;
  const bMembers = b.kind === 'album' ? b.messages : null;
  if (aMembers === null || bMembers === null) {
    return aMembers === bMembers;
  }
  return aMembers.length === bMembers.length && aMembers.every((m, index) => m === bMembers[index]);
}

// Whether the row can skip a render. `item` is rebuilt every list rebuild (a draft frame is one every ~150 ms), so it is compared field by field; the other props are compared by identity.
function areRowPropsEqual(prev: MessageListRowProps, next: MessageListRowProps): boolean {
  return (
    isSameEntry(prev.item, next.item) &&
    prev.isGroup === next.isGroup &&
    prev.currentUserId === next.currentUserId &&
    prev.canPinChat === next.canPinChat &&
    prev.pinnedIds === next.pinnedIds &&
    prev.openingAttachmentId === next.openingAttachmentId &&
    prev.voiceHost === next.voiceHost &&
    prev.selection === next.selection &&
    prev.onReply === next.onReply &&
    prev.onReact === next.onReact &&
    prev.onForward === next.onForward &&
    prev.onRetrySticker === next.onRetrySticker &&
    prev.onRetryAttachment === next.onRetryAttachment &&
    prev.onCancelAttachment === next.onCancelAttachment &&
    prev.onRetryVoice === next.onRetryVoice &&
    prev.onCancelVoice === next.onCancelVoice &&
    prev.onOpenAttachment === next.onOpenAttachment &&
    prev.onToggleSelect === next.onToggleSelect
  );
}

// Memoised: with the list's stable handlers, a draft frame re-renders only the row whose entry changed.
export const MessageListRow = memo(MessageListRowImpl, areRowPropsEqual);
