import type { Contact } from '@zilar/api-contract';
import type { AvatarPersonInput, ChatSummary, MentionMember } from '@zilar/chat-core';
import { type HandoffLine as HandoffLineData, jidLocal } from '@zilar/protocol';
import { ArrowRight } from 'lucide-react';
import { useState } from 'react';
import { EntityAvatar } from '../EntityAvatar';
import { useChatSelector } from '@/store/ChatStoreProvider';

/**
 * The person behind one handoff JID (T-1575): the chat's own members first, then
 * the contacts / AI list, then the AI chat rows, and the JID's localpart as the
 * last resort so a line always names something.
 */
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
  /** The card message's resolved sender, the `from` orb's fallback name. */
  senderName: string;
  /** Toggles the full reply bubble under the line. */
  onToggle: () => void;
}

/**
 * The board's small centred handoff line (T-1575): the sender's 16 px orb, a
 * muted arrow, the targets' 16 px orbs, then the one-line task. Clicking it
 * toggles the full bubble of the reply it belongs to.
 */
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
  // The row owns the bubble's visibility, so this local flag mirrors it: both
  // flip on the same click and stay in step. It only feeds `aria-expanded`.
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
