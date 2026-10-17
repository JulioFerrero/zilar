import { avatarIdentity, writingLabel, type ChatSummary, type TopicInfoAi } from '@zilar/chat-core';
import type { GroupDetail } from '@/lib/api';
import { useChatSelector } from '@/store/ChatStoreProvider';
import { cn } from '@/lib/utils';
import { Avatar } from '../Avatar';

/** The board's stack shows at most four pictures (WebTopic.dc.html:58). */
const STACK_MAX = 4;
/** The writing line shows at most three writers' pictures (PhoneHeader.dc.html). */
const WRITERS_MAX = 3;
const AVATAR_SIZE = 20;

/** One person drawn in the line: the id, the display name and its picture. */
interface LinePerson {
  id: string;
  name: string;
  avatarUrl?: string | undefined;
}

type GroupMember = GroupDetail['members'][number];
type GroupAi = GroupDetail['ais'][number];

function personOfMember(member: GroupMember): LinePerson {
  return { id: member.userId, name: member.name, avatarUrl: member.avatarUrl };
}

function personOfTopicAi(ai: TopicInfoAi): LinePerson {
  return { id: ai.id, name: ai.name, avatarUrl: ai.avatarUrl };
}

function personOfGroupAi(ai: GroupAi): LinePerson {
  return { id: ai.aiId, name: ai.name, avatarUrl: ai.avatarUrl };
}

/**
 * The topic's AIs: its `ais` list, or the whole group's for General, which
 * carries no list of its own (T-1777).
 */
function topicAis(chat: ChatSummary, info: GroupDetail | undefined): LinePerson[] {
  const topic = chat.topic;
  if (topic === undefined) {
    return [];
  }
  return topic.isGeneral
    ? (info?.ais ?? []).map(personOfGroupAi)
    : (topic.ais ?? []).map(personOfTopicAi);
}

/**
 * The topic's people: its `memberIds`, with the names and pictures from the
 * group detail, or the whole group's people for General.
 */
function topicPeople(chat: ChatSummary, info: GroupDetail | undefined): LinePerson[] {
  const topic = chat.topic;
  if (topic === undefined) {
    return [];
  }
  if (topic.isGeneral) {
    return (info?.members ?? []).map(personOfMember);
  }
  const members = new Map((info?.members ?? []).map((member) => [member.userId, member]));
  return (topic.memberIds ?? []).map((id) => {
    const member = members.get(id);
    // The names and pictures land with the group detail; until then the id is
    // still a stable seed, so the orb does not change when it arrives.
    return { id, name: member?.name ?? id, avatarUrl: member?.avatarUrl };
  });
}

/** The topic's people, then its AIs, in the board's stack order. */
function linePeople(chat: ChatSummary, info: GroupDetail | undefined): LinePerson[] {
  return [...topicPeople(chat, info), ...topicAis(chat, info)];
}

/** The `group · N` count: the topic's people plus its AIs. */
function topicCount(chat: ChatSummary, info: GroupDetail | undefined): number {
  return topicPeople(chat, info).length + topicAis(chat, info).length;
}

/**
 * The writers, matched by display name to the group's people or the topic's
 * AIs. A name that matches nothing keeps its own name as the orb seed, so the
 * same writer draws the same ball (the orb-by-name rule, T-1334).
 */
function writerPeople(
  names: readonly string[],
  chat: ChatSummary,
  info: GroupDetail | undefined,
): LinePerson[] {
  const candidates = [...(info?.members ?? []).map(personOfMember), ...topicAis(chat, info)];
  return names.slice(0, WRITERS_MAX).map((name, index) => {
    const match = candidates.find((person) => person.name === name);
    return match ?? { id: `writer-${index}`, name, avatarUrl: undefined };
  });
}

/** The overlapping pictures the line opens with, ringed like the board's `.st`. */
function AvatarStack({ people }: { people: readonly LinePerson[] }) {
  if (people.length === 0) {
    return null;
  }
  return (
    <span aria-hidden="true" className="flex shrink-0 items-center">
      {people.map((person, index) => {
        const identity = avatarIdentity({
          name: person.name,
          id: person.id,
          ...(person.avatarUrl === undefined ? {} : { avatarUrl: person.avatarUrl }),
        });
        return (
          <Avatar
            key={person.id}
            seed={identity.seed}
            name={identity.name}
            size={AVATAR_SIZE}
            {...(identity.avatarUrl === undefined ? {} : { avatarUrl: identity.avatarUrl })}
            className={cn('rounded-full ring-2 ring-[var(--avatar-ring)]', index > 0 && '-ml-1.5')}
          />
        );
      })}
    </span>
  );
}

/**
 * A topic header's second line (T-1779, plan W1): the ≤4 avatar stack with
 * `group · N` when nobody writes, swapped for the writers' avatars,
 * `writingLabel(names)` and a pulsing dot while someone does. The line keeps
 * its height in both states so the 64 px header never moves.
 */
export function TopicPeopleLine({
  chat,
  groupTitle,
  names,
  onOpen,
}: {
  chat: ChatSummary;
  groupTitle: string | undefined;
  names: readonly string[];
  onOpen?: (() => void) | undefined;
}) {
  const info = useChatSelector((state) => state.groupInfo(chat.id));
  const writing = writingLabel(names);
  if (writing !== undefined) {
    return (
      <span
        role="status"
        className="flex h-5 min-w-0 items-center gap-1.5 text-[12px] leading-4 text-muted-foreground"
      >
        <AvatarStack people={writerPeople(names, chat, info)} />
        <span className="truncate">{writing}</span>
        <span
          aria-hidden="true"
          className="pulse-dot size-1.5 shrink-0 rounded-full bg-foreground shadow-[0_0_0_3px_rgba(237,237,237,0.14)]"
        />
      </span>
    );
  }
  const count = topicCount(chat, info);
  const label =
    groupTitle === undefined || groupTitle === '' ? `${count}` : `${groupTitle} · ${count}`;
  const className =
    'flex h-5 min-w-0 items-center gap-1.5 text-[12px] leading-4 text-muted-foreground';
  const content = (
    <>
      <AvatarStack people={linePeople(chat, info).slice(0, STACK_MAX)} />
      <span className="truncate">{label}</span>
    </>
  );
  // T-1852: with no handler the line stays a plain span; the header passes one
  // so tapping the people opens the topic panel.
  if (onOpen === undefined) {
    return <span className={className}>{content}</span>;
  }
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label="People in this topic"
      className={cn(
        className,
        'rounded-md text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40',
      )}
    >
      {content}
    </button>
  );
}
