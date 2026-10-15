import type { AvatarPersonInput, ChatSummary, MentionMember } from '@zilar/chat-core';
import { type HandoffLine as HandoffLineData, jidLocal } from '@zilar/protocol';
import { ArrowRight } from 'lucide-react-native';
import { Pressable } from 'react-native';

import { EntityAvatar } from '@/components/chat/entity-avatar';
import { Text } from '@/components/ui/text';
import type { Contact } from '@/lib/chat-api';
import { MUTED_FOREGROUND } from '@/lib/colors';
import { useChatStore } from '@/store/chat-store-provider';

interface PersonSources {
  members: readonly MentionMember[];
  contacts: readonly Contact[];
  chats: readonly ChatSummary[];
}

/**
 * The person behind one handoff JID (T-1575): the chat's own members first, then
 * the contacts / AI list, then the AI chat rows, and the JID's localpart as the
 * last resort so a line always names something.
 */
function personFor(jid: string, sources: PersonSources, fallbackName = ''): AvatarPersonInput {
  const member = sources.members.find((entry) => entry.jid === jid);
  const contact = sources.contacts.find((entry) => entry.jid === jid);
  const chat = sources.chats.find((entry) => entry.id === jid);
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
  /** The chat row whose members name the target AIs. */
  chatId: string;
  /** The card message's resolved sender, the `from` orb's fallback name. */
  senderName: string;
  /** Toggles the full reply bubble under the line. */
  onToggle: () => void;
}

/**
 * The board's small centred handoff line (T-1575): the sender's 16 px orb, a
 * muted arrow, the targets' 16 px orbs, then the one-line task. A press toggles
 * the full bubble of the reply it belongs to.
 */
export function HandoffLine({ card, chatId, senderName, onToggle }: HandoffLineProps) {
  const contacts = useChatStore((state) => state.contacts);
  const chats = useChatStore((state) => state.chats);
  const groupMembers = useChatStore((state) => state.groupMembers);
  // Re-resolves when an async group detail lands: `groupMembers` reads a plain
  // closure cache and would otherwise keep returning the value from first render.
  useChatStore((state) => state.groupDetailsRevision);
  const sources: PersonSources = { members: groupMembers(chatId), contacts, chats };
  const from = personFor(card.from, sources, senderName);
  const to = card.to.map((jid) => personFor(jid, sources));
  const targets = to.map((person) => person.name).join(', ');
  const handedOff = `${from.name} handed off to ${targets}`;
  const label = card.task === '' ? handedOff : `${handedOff}: ${card.task}`;

  return (
    <Pressable
      onPress={onToggle}
      accessibilityRole="button"
      accessibilityLabel={label}
      className="flex-row items-center gap-2"
    >
      <EntityAvatar person={from} size={16} ai />
      <ArrowRight size={14} color={MUTED_FOREGROUND} />
      {to.map((person, index) => (
        <EntityAvatar key={card.to[index]} person={person} size={16} ai />
      ))}
      {card.task !== '' ? (
        <Text numberOfLines={1} className="shrink text-[14px]" color={MUTED_FOREGROUND}>
          {card.task}
        </Text>
      ) : null}
    </Pressable>
  );
}
