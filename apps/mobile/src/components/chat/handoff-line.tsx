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

/** Resolves from the chat's members, then contacts and AIs, then the JID
 *  localpart, so a line always names something. */
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
  chatId: string;
  senderName: string;
  onToggle: () => void;
}

export function HandoffLine({ card, chatId, senderName, onToggle }: HandoffLineProps) {
  const contacts = useChatStore((state) => state.contacts);
  const chats = useChatStore((state) => state.chats);
  const groupMembers = useChatStore((state) => state.groupMembers);
  // Reads `groupMembers` to re-resolve when an async group detail lands.
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
