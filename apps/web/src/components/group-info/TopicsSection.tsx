import { isTopicJoined, sortTopics, type ChatSummary, type TopicInfo } from '@zilar/chat-core';
import { Effect } from 'effect';
import { BellOff, Loader2, Lock, Plus } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router';
import type { GroupDetail, GroupMember } from '@/lib/api';
import { failureOf, isWaiting, useAction } from '@/lib/effect/use-action';
import { useChatSelector, useChatStoreApi } from '@/store/ChatStoreProvider';
import { NewTopicDialog } from '../NewTopicDialog';
import { PanelFailure } from '../panels/groupPanelOps';
import { Avatar } from '../Avatar';
import { Button } from '../ui/button';

const JOIN_ERROR = "Couldn't join";

/** One avatar of a topic row's stack: a person or an AI. */
interface StackEntry {
  id: string;
  name: string;
  avatarUrl?: string;
}

function memberById(info: GroupDetail | undefined): Map<string, GroupMember> {
  return new Map((info?.members ?? []).map((member) => [member.userId, member]));
}

/** The people of a topic, with the names and pictures the group detail holds. */
function peopleOf(topic: TopicInfo, info: GroupDetail | undefined): StackEntry[] {
  const byId = memberById(info);
  return (topic.memberIds ?? []).map((userId) => {
    const member = byId.get(userId);
    return {
      id: userId,
      name: member?.name ?? userId,
      ...(member?.avatarUrl === undefined ? {} : { avatarUrl: member.avatarUrl }),
    };
  });
}

/** The topic's AIs, in the order the row lists them. */
function aisOf(topic: TopicInfo): StackEntry[] {
  return (topic.ais ?? []).map((ai) => ({
    id: ai.id,
    name: ai.name,
    ...(ai.avatarUrl === undefined ? {} : { avatarUrl: ai.avatarUrl }),
  }));
}

function firstName(name: string): string {
  return name.split(' ')[0] ?? name;
}

/**
 * The row's second line (T-1786, `WebGroup.dc.html:71-104`): "Everyone" for
 * General, "N people · <first AI>" on a public topic, and a private topic's
 * first two people by name before its first AI.
 */
function subtitleOf(topic: TopicInfo, info: GroupDetail | undefined): string {
  if (topic.isGeneral) {
    return 'Everyone';
  }
  const firstAi = topic.ais?.[0]?.name;
  if (topic.visibility === 'private') {
    const names = peopleOf(topic, info)
      .slice(0, 2)
      .map((person) => firstName(person.name));
    const base = names.join(', ');
    if (base === '') {
      return firstAi ?? '';
    }
    return firstAi === undefined ? base : `${base} · ${firstAi}`;
  }
  const count = topic.memberIds?.length ?? 0;
  return firstAi === undefined ? `${count} people` : `${count} people · ${firstAi}`;
}

/** The flat topic tile: the row's glyph, or a lock when the topic is private. */
function TopicGlyph({ topic }: { topic: TopicInfo }) {
  return (
    <span className="flex size-8 shrink-0 items-center justify-center rounded-[10px] border border-border bg-surface-raised text-[15px] font-semibold text-foreground/80">
      {topic.visibility === 'private' ? (
        <Lock className="size-3.5" role="img" aria-label="Private" />
      ) : (
        topic.glyph
      )}
    </span>
  );
}

/** The overlapping stack: at most four people, then the topic's AIs. */
function AvatarStack({ entries }: { entries: StackEntry[] }) {
  if (entries.length === 0) {
    return null;
  }
  return (
    <span className="flex shrink-0 items-center" aria-hidden="true">
      {entries.map((entry, index) => (
        <Avatar
          key={entry.id}
          seed={entry.name}
          name={entry.name}
          size={20}
          className={index === 0 ? 'border-2 border-surface' : '-ml-1.5 border-2 border-surface'}
          {...(entry.avatarUrl === undefined ? {} : { avatarUrl: entry.avatarUrl })}
        />
      ))}
    </span>
  );
}

/** One topic row: the tile, the name and subtitle, the muted icon and the stack. */
export function TopicRow({
  chat,
  info,
  onOpen,
  showStack = false,
  trailing,
}: {
  chat: ChatSummary;
  info: GroupDetail | undefined;
  onOpen: (chatId: string) => void;
  /** Paint the people-and-AIs stack of a Your-topic row. */
  showStack?: boolean;
  trailing?: ReactNode;
}) {
  const topic = chat.topic;
  if (topic === undefined) {
    return null;
  }
  return (
    <div className="flex min-h-[50px] items-center gap-2.5 px-2.5 text-[14px]">
      <button
        type="button"
        onClick={() => onOpen(chat.id)}
        aria-label={`Open ${chat.title}`}
        className="flex min-w-0 flex-1 items-center gap-2.5 rounded-[10px] text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
      >
        <TopicGlyph topic={topic} />
        <span className="flex min-w-0 flex-1 flex-col gap-px">
          <span className="truncate text-[14px] text-foreground">{chat.title}</span>
          <span className="truncate text-[12px] text-[#8a8a8a]">{subtitleOf(topic, info)}</span>
        </span>
        {chat.muted === true && (
          <BellOff className="size-3.5 shrink-0 text-[#8a8a8a]" role="img" aria-label="Muted" />
        )}
        {showStack && (
          <AvatarStack entries={[...peopleOf(topic, info).slice(0, 4), ...aisOf(topic)]} />
        )}
      </button>
      {trailing}
    </div>
  );
}

/**
 * The two topic lists (T-1786, `WebGroup.dc.html:66-109`), presentational so the
 * Cosmos fixture can paint static rows. `TopicsSection` computes their data.
 */
export function TopicsList({
  yourTopics,
  otherTopics,
  info,
  onOpen,
  onNewTopic,
  renderJoin,
}: {
  yourTopics: ChatSummary[];
  otherTopics: ChatSummary[];
  info: GroupDetail | undefined;
  onOpen: (chatId: string) => void;
  onNewTopic: () => void;
  renderJoin?: (chat: ChatSummary) => ReactNode;
}) {
  return (
    <>
      <section className="flex flex-col gap-2">
        <span className="px-0.5 text-[12px] font-semibold text-muted-foreground">Your topics</span>
        <nav
          aria-label="Your topics"
          className="divide-y divide-divider overflow-hidden rounded-xl border border-border bg-surface"
        >
          {yourTopics.map((chat) => (
            <TopicRow key={chat.id} chat={chat} info={info} onOpen={onOpen} showStack />
          ))}
          <button
            type="button"
            onClick={onNewTopic}
            aria-label="New topic"
            className="flex min-h-[50px] w-full items-center gap-2.5 px-2.5 text-left text-[14px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
          >
            <span className="key-icon flex size-8 shrink-0 items-center justify-center rounded-[10px]">
              <Plus className="size-[15px]" aria-hidden="true" />
            </span>
            <span className="flex-1 text-foreground">New topic</span>
          </button>
        </nav>
      </section>

      {otherTopics.length > 0 && (
        <section className="flex flex-col gap-2">
          <span className="px-0.5 text-[12px] font-semibold text-muted-foreground">
            Other topics
          </span>
          <div className="divide-y divide-divider overflow-hidden rounded-xl border border-border bg-surface">
            {otherTopics.map((chat) => {
              const join = renderJoin?.(chat);
              return (
                <TopicRow
                  key={chat.id}
                  chat={chat}
                  info={info}
                  onOpen={onOpen}
                  {...(join === undefined ? {} : { trailing: join })}
                />
              );
            })}
          </div>
        </section>
      )}
    </>
  );
}

/**
 * The Join key of an Other-topic row: busy while its request runs and a muted
 * "Couldn't join" on the row when it fails.
 */
function JoinKey({ chat }: { chat: ChatSummary }) {
  const storeApi = useChatStoreApi();
  const [state, run] = useAction<void, void, PanelFailure>(() =>
    Effect.tryPromise({
      try: () => storeApi.getState().joinTopic(chat.id),
      catch: () => new PanelFailure({ message: JOIN_ERROR }),
    }),
  );
  const busy = isWaiting(state);
  const error = busy ? undefined : failureOf(state)?.message;
  return (
    <span className="flex shrink-0 items-center gap-2">
      {error !== undefined && <span className="text-[12px] text-[#8a8a8a]">{error}</span>}
      <Button
        type="button"
        size="sm"
        className="rounded-lg px-3 text-[13px] font-medium"
        aria-label={`Join ${chat.title}`}
        disabled={busy}
        aria-busy={busy || undefined}
        onClick={() => run()}
      >
        {busy && (
          <Loader2
            className="size-3.5 animate-spin motion-reduce:animate-none"
            aria-hidden="true"
          />
        )}
        {busy ? 'Joining…' : 'Join'}
      </Button>
    </span>
  );
}

/**
 * The group screen's Your/Other topics (T-1786): the group's topic rows split
 * by the caller's membership, General first. It owns its reads; a row opens the
 * topic and closes the panel, and New topic opens the dialog.
 */
export function TopicsSection({
  chat,
  onClose,
}: {
  /** The group's General row; `chat.id` keys the detail and `chat.groupId` is the group. */
  chat: ChatSummary;
  onClose: () => void;
}) {
  const chats = useChatSelector((s) => s.chats);
  const info = useChatSelector((s) => s.groupInfo(chat.id));
  const me = useChatSelector((s) => s.currentUserId);
  const navigate = useNavigate();
  const [newOpen, setNewOpen] = useState(false);

  const groupId = chat.groupId;
  const topics =
    groupId === undefined
      ? []
      : chats.filter(
          (row) =>
            row.groupId === groupId && row.topic !== undefined && row.topic.archived !== true,
        );
  const joined = (row: ChatSummary): boolean =>
    row.topic !== undefined && isTopicJoined(row.topic, me ?? '');
  const yourTopics = sortTopics(topics.filter(joined));
  const otherTopics = sortTopics(
    topics.filter((row) => row.topic?.visibility === 'public' && !joined(row)),
  );

  const openTopic = (chatId: string): void => {
    onClose();
    navigate(`/c/${encodeURIComponent(chatId)}`);
  };

  return (
    <>
      <TopicsList
        yourTopics={yourTopics}
        otherTopics={otherTopics}
        info={info}
        onOpen={openTopic}
        onNewTopic={() => setNewOpen(true)}
        renderJoin={(row) => <JoinKey chat={row} />}
      />
      {newOpen && <NewTopicDialog groupId={chat.id} onClose={() => setNewOpen(false)} />}
    </>
  );
}
