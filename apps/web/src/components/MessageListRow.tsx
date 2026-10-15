import type { ChatSummary, RenderItem, UiMessage } from '@zilar/chat-core';
import { Fragment, useState, type RefObject } from 'react';
import { DateSeparator } from './DateSeparator';
import { MessageBubble } from './MessageBubble';
import { UnreadDivider } from './UnreadDivider';
import { AlbumMembersProvider } from './message/AlbumGrid';
import { HandoffLine } from './message/HandoffLine';

export interface MessageListRowProps {
  item: RenderItem;
  index: number;
  dividerIndex: number | null;
  dividerRef: RefObject<HTMLDivElement | null>;
  draftMessageId: string | undefined;
  draftTurnId: string | undefined;
  finishedDraftMessages: Record<string, string | undefined>;
  chat: ChatSummary;
  meId: string;
  meJid: string | undefined;
  onReply: (message: UiMessage) => void;
  onForward: ((message: UiMessage) => void) | undefined;
  selectionIds: ReadonlySet<string> | undefined;
  onToggleSelect: ((message: UiMessage) => void) | undefined;
  onStartSelect: ((message: UiMessage) => void) | undefined;
  selecting: boolean;
}

/**
 * The React key of one render item: the final message keeps the draft's key so
 * React reuses the same bubble and its reveal carries on instead of snapping.
 */
export function messageRowKey(
  item: RenderItem,
  draftMessageId: string | undefined,
  draftTurnId: string | undefined,
  finishedDraftMessages: Record<string, string | undefined>,
): string {
  if (item.kind === 'separator') {
    return item.id;
  }
  const revealTurnId =
    item.message.id === draftMessageId ? draftTurnId : finishedDraftMessages[item.message.id];
  return revealTurnId === undefined ? item.message.id : `draft-${revealTurnId}`;
}

/**
 * One row of the message list: the unread divider, a date separator, or a
 * message bubble. An album item renders its head bubble, whose attachment body
 * swaps in the grid, with the item's grouped members handed to the grid so it
 * draws exactly that run (T-1268). A `handoff.line` card renders the small
 * centred handoff line instead of the bubble, which a click toggles below it
 * (T-1575).
 */
export function MessageListRow({
  item,
  index,
  dividerIndex,
  dividerRef,
  draftMessageId,
  draftTurnId,
  finishedDraftMessages,
  chat,
  meId,
  meJid,
  onReply,
  onForward,
  selectionIds,
  onToggleSelect,
  onStartSelect,
  selecting,
}: MessageListRowProps) {
  const isDraft = item.kind === 'message' && item.message.id === draftMessageId;
  const revealTurnId =
    item.kind === 'separator'
      ? undefined
      : isDraft
        ? draftTurnId
        : finishedDraftMessages[item.message.id];
  const albumMembers = item.kind === 'album' ? item.messages : null;
  const card = item.kind === 'separator' ? undefined : item.message.card;
  const handoff = card?.type === 'handoff.line' ? card.data : undefined;
  const handoffSender = item.kind === 'separator' ? '' : item.message.senderName;
  const [handoffOpen, setHandoffOpen] = useState(false);
  const bubble =
    item.kind === 'separator' ? null : (
      <MessageBubble
        message={item.message}
        chat={chat}
        firstInGroup={item.firstInGroup}
        lastInGroup={item.lastInGroup}
        currentUserId={meId}
        meJid={meJid}
        onReply={onReply}
        {...(onForward === undefined ? {} : { onForward })}
        selecting={selecting}
        selected={selectionIds !== undefined && selectionIds.has(item.message.id)}
        {...(onToggleSelect === undefined ? {} : { onToggleSelect })}
        {...(onStartSelect === undefined ? {} : { onStartSelect })}
        draft={isDraft}
        {...(revealTurnId === undefined ? {} : { revealTurnId })}
      />
    );
  return (
    <Fragment>
      {dividerIndex === index && <UnreadDivider ref={dividerRef} />}
      <AlbumMembersProvider messages={albumMembers}>
        {item.kind === 'separator' ? (
          <DateSeparator date={item.date} />
        ) : handoff !== undefined ? (
          <>
            <HandoffLine
              card={handoff}
              chat={chat}
              senderName={handoffSender}
              onToggle={() => setHandoffOpen((open) => !open)}
            />
            {handoffOpen && bubble}
          </>
        ) : (
          bubble
        )}
      </AlbumMembersProvider>
    </Fragment>
  );
}
