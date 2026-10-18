import { avatarIdentity, writingLabel, type ChatSummary, type TopicInfoAi } from '@zilar/chat-core';
import type { GroupDetail } from '@/lib/api';
import { useChatSelector } from '@/store/ChatStoreProvider';
import { cn } from '@/lib/utils';
import { Avatar } from '../Avatar';

const STACK_MAX = 4;
const WRITERS_MAX = 3;
const AVATAR_SIZE = 20;

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

function topicAis(chat: ChatSummary, info: GroupDetail | undefined): LinePerson[] {
  const topic = chat.topic;
  if (topic === undefined) {
    return [];
  }
  return topic.isGeneral
    ? (info?.ais ?? []).map(personOfGroupAi)
    : (topic.ais ?? []).map(personOfTopicAi);
}

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
    // The names and pictures land with the group detail; until then the id is a
    // stable seed, so the orb does not change when they arrive.
    return { id, name: member?.name ?? id, avatarUrl: member?.avatarUrl };
  });
}

function linePeople(chat: ChatSummary, info: GroupDetail | undefined): LinePerson[] {
  return [...topicPeople(chat, info), ...topicAis(chat, info)];
}

function topicCount(chat: ChatSummary, info: GroupDetail | undefined): number {
  return topicPeople(chat, info).length + topicAis(chat, info).length;
}

/**
 * A name that matches nothing keeps its own name as the orb seed, so the same
 * writer always draws the same ball.
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
 * The line keeps its height in both states so the 64 px header never moves.
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
