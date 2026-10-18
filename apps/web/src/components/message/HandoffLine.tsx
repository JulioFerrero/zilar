import type { Contact } from '@zilar/api-contract';
import type { AvatarPersonInput, ChatSummary, MentionMember } from '@zilar/chat-core';
import { type HandoffLine as HandoffLineData, jidLocal } from '@zilar/protocol';
import { ArrowRight } from 'lucide-react';
import { useState } from 'react';
import { EntityAvatar } from '../EntityAvatar';
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
