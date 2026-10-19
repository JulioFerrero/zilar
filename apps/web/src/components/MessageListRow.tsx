import type { Contact } from '@zilar/api-contract';
import {
  formatDateSeparator,
  type AvatarPersonInput,
  type ChatSummary,
  type MentionMember,
  type RenderItem,
  type UiMessage,
} from '@zilar/chat-core';
import { type HandoffLine as HandoffLineData, jidLocal } from '@zilar/protocol';
import { ArrowRight } from 'lucide-react';
import { Fragment, useState, type RefObject, type Ref } from 'react';
import { EntityAvatar } from './EntityAvatar';
import { MessageBubble } from './MessageBubble';
import { AlbumMembersProvider } from '@zilar/client-core';
import { useChatSelector } from '@/store/ChatStoreProvider';

function personFor(
  jid: string,
  members: readonly MentionMember[],
  contacts: readonly Contact[],
  chats: readonly ChatSummary[],
  fallbackName = '',
): AvatarPersonInput {
  const member = members.find((entry) => entry.jid === jid);
  const contact = contacts.find((entry) => entry.jid === jid);
  const chat = chats.find((entry) => entry.id === jid);
  const name =
    member?.name ??
    contact?.name ??
    chat?.title ??
    (fallbackName === '' ? jidLocal(jid) : fallbackName);
  const avatarUrl = contact?.avatarUrl ?? chat?.avatarUrl;
  return { id: jid, name, ...(avatarUrl === undefined ? {} : { avatarUrl }) };
}

export interface HandoffLineProps {
  card: HandoffLineData;
  chat: ChatSummary;
  senderName: string;
  onToggle: () => void;
}

export function HandoffLine({ card, chat, senderName, onToggle }: HandoffLineProps) {
  const groupMembers = useChatSelector((state) => state.groupMembers);
  const contacts = useChatSelector((state) => state.contacts);
  const chats = useChatSelector((state) => state.chats);
  const members = groupMembers(chat.id);
  const from = personFor(card.from, members, contacts, chats, senderName);
  const to = card.to.map((jid) => personFor(jid, members, contacts, chats));
  const targets = to.map((person) => person.name).join(', ');
  const handedOff = `${from.name} handed off to ${targets}`;
  const label = card.task === '' ? handedOff : `${handedOff}: ${card.task}`;
  const [expanded, setExpanded] = useState(false);

  return (
    <button
      type="button"
      aria-label={label}
      aria-expanded={expanded}
      onClick={() => {
        setExpanded((open) => !open);
        onToggle();
      }}
      className="my-0.5 flex max-w-full items-center gap-2 self-center rounded-[8px] px-2 py-1 text-[13px] text-muted-foreground transition-colors hover:bg-white/5"
    >
      <EntityAvatar person={from} size={16} ai className="shrink-0" />
      <ArrowRight className="size-[14px] shrink-0" aria-hidden="true" />
      {to.map((person, index) => (
        <EntityAvatar key={card.to[index]} person={person} size={16} ai className="shrink-0" />
      ))}
      {card.task !== '' && <span className="truncate">{card.task}</span>}
    </button>
  );
}

/**
 * A plain flow row: a sticky one pins every separator at once and covers
 * messages, since they all share the list as containing block.
 */
function DateSeparator({ date }: { date: Date }) {
  return (
    <div className="flex justify-center py-2">
      <span className="raised-pill rounded-full px-2.5 py-1 text-[12px] font-medium text-muted-foreground">
        {formatDateSeparator(date, new Date())}
      </span>
    </div>
  );
}

function UnreadDivider({ ref }: { ref?: Ref<HTMLDivElement> }) {
  return (
    <div ref={ref} className="my-3 w-full">
      <div className="well-surface w-full rounded-[10px] px-3 py-1.5 text-center text-[12px] font-medium text-muted-foreground">
        Unread messages
      </div>
    </div>
  );
}

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
  pinId: string | undefined;
  onReply: (message: UiMessage) => void;
  onForward: ((message: UiMessage) => void) | undefined;
  selectionIds: ReadonlySet<string> | undefined;
  onToggleSelect: ((message: UiMessage) => void) | undefined;
  onStartSelect: ((message: UiMessage) => void) | undefined;
  selecting: boolean;
}

/**
 * The React key: the final message keeps the draft's key, so the same bubble
 * (and its reveal) carries on instead of snapping.
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
  pinId,
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
        pinId={pinId}
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
