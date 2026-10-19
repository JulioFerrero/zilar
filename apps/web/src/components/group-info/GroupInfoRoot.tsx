import type { ChatSummary, TopicInfo } from '@zilar/chat-core';
import { isTopicJoined, sortTopics } from '@zilar/chat-core';
import { Effect } from 'effect';
import {
  Bell,
  BellOff,
  Image as ImageIcon,
  Loader2,
  Lock,
  MoreHorizontal,
  Plus,
  Search,
  Settings,
  Trash2,
  UserPlus,
  Wrench,
  X,
} from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router';
import type { GroupDetail, GroupMember } from '@/lib/api';
import { useAction } from '@/lib/effect/use-action';
import { useChatSelector, useChatStoreApi } from '@/store/ChatStoreProvider';
import { useMuteToggle } from '../useMuteToggle';
import { Avatar } from '../Avatar';
import { EntityAvatar } from '../EntityAvatar';
import { NewTopicDialog } from '../NewTopicDialog';
import { PanelFailure } from '../panels/groupPanelOps';
import { Button } from '../ui/button';
import { SectionLabel } from '../ui/card';
import { IconButton } from '../ui/icon-button';
import { ListRow } from '../ui/list-row';
import { Menu, MenuItem } from '../ui/menu';
import { PanelKey } from '../ui/panel-key';
import { ContentNav } from './ContentNav';
import { DeleteGroupDialog, LeaveGroupRow } from './GroupExit';
import type { AvatarStackEntry } from '@zilar/chat-core';
import { failureOf, isWaiting } from '@zilar/client-core';

export type GroupInfoPageId =
  'root' | 'people' | 'links' | 'tools' | 'activity' | 'allowed' | 'settings';

export const GROUP_INFO_TITLES: Record<GroupInfoPageId, string> = {
  root: '',
  people: 'People and AIs',
  links: 'Invite links',
  tools: 'Tools and routines',
  activity: 'Activity',
  allowed: 'Always allowed',
  settings: 'Settings',
};

export function GroupInfoRoot({
  chat,
  title,
  groupId,
  memberCount,
  stack,
  isManager,
  isOwner,
  canLeave,
  onClose,
  onSearch,
  onOpenMedia,
  onOpenBackground,
  onOpenPage,
  onAddMembers,
}: {
  chat: ChatSummary;
  title: string;
  groupId: string | undefined;
  memberCount: number;
  stack: AvatarStackEntry[];
  isManager: boolean;
  isOwner: boolean;
  canLeave: boolean;
  onClose: () => void;
  onSearch: () => void;
  onOpenMedia: () => void;
  onOpenBackground: () => void;
  onOpenPage: (page: GroupInfoPageId) => void;
  onAddMembers: () => void;
}) {
  const { muted, busy: muteBusy, error: muteError, toggle: toggleMute } = useMuteToggle(chat);
  const pinCount = useChatSelector((s) => s.pinsByChat[chat.id]?.length ?? 0);
  const [moreOpen, setMoreOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

  return (
    <>
      <header className="flex h-14 shrink-0 items-center justify-end px-3">
        <IconButton aria-label="Close group info" onClick={onClose}>
          <X className="size-4" aria-hidden="true" />
        </IconButton>
      </header>

      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
        <div className="flex flex-col items-center gap-1.5 px-4 pb-4">
          <EntityAvatar chat={{ id: chat.id, title, avatarUrl: chat.avatarUrl }} size={84} />
          <h2 className="mt-1.5 max-w-full truncate text-[20px] font-semibold tracking-tight">
            {title}
          </h2>
          <p className="text-[13px] text-muted-foreground">
            {memberCount} {memberCount === 1 ? 'member' : 'members'}
          </p>
        </div>

        <div className="flex justify-center gap-1 pb-[18px]">
          <PanelKey
            label={muted ? 'Unmute' : 'Mute'}
            icon={muted ? BellOff : Bell}
            onClick={toggleMute}
            disabled={muteBusy}
          />
          <PanelKey label="Search" icon={Search} onClick={onSearch} />
          {isManager && <PanelKey label="Add" icon={UserPlus} onClick={onAddMembers} />}
          {(isManager || isOwner) && (
            <div className="flex w-16 flex-col items-center gap-1.5">
              <Menu
                open={moreOpen}
                onOpenChange={setMoreOpen}
                label="More"
                trigger={
                  <IconButton aria-label="More">
                    <MoreHorizontal className="size-[18px]" aria-hidden="true" />
                  </IconButton>
                }
              >
                {isManager && (
                  <MenuItem
                    icon={ImageIcon}
                    onSelect={() => {
                      setMoreOpen(false);
                      onOpenBackground();
                    }}
                  >
                    Group background
                  </MenuItem>
                )}
                {isOwner && (
                  <MenuItem
                    icon={Trash2}
                    destructive
                    onSelect={() => {
                      setMoreOpen(false);
                      setDeleteOpen(true);
                    }}
                  >
                    Delete group
                  </MenuItem>
                )}
              </Menu>
              <span className="text-[12px] text-muted-foreground">More</span>
            </div>
          )}
        </div>

        {muteError !== undefined && (
          <p role="alert" className="px-3 pb-3 text-center text-[13px] text-danger">
            {muteError}
          </p>
        )}

        <div className="flex flex-col gap-2.5 px-3 pb-3">
          <nav
            aria-label="People"
            className="divide-y divide-divider overflow-hidden rounded-xl border border-border bg-surface"
          >
            <ListRow
              leading={<AvatarStack entries={stack.slice(0, 5)} size={18} />}
              title="People and AIs"
              trailing={<span className="font-mono text-[12px]">{memberCount}</span>}
              chevron
              onClick={() => onOpenPage('people')}
            />
          </nav>

          <TopicsSection chat={chat} onClose={onClose} />

          <ContentNav
            chatId={chat.id}
            pinCount={pinCount}
            isManager={isManager}
            onOpenMedia={onOpenMedia}
            onOpenPage={onOpenPage}
            extraRow={
              <ListRow
                icon={<Wrench className="size-4" aria-hidden="true" />}
                title="Tools and routines"
                chevron
                onClick={() => onOpenPage('tools')}
              />
            }
          />

          {isManager && (
            <nav
              aria-label="Settings"
              className="divide-y divide-divider overflow-hidden rounded-xl border border-border bg-surface"
            >
              <ListRow
                icon={<Settings className="size-4" aria-hidden="true" />}
                title="Settings"
                chevron
                onClick={() => onOpenPage('settings')}
              />
            </nav>
          )}

          {canLeave && <LeaveGroupRow chatId={chat.id} title={title} onClose={onClose} />}
        </div>
      </div>

      <DeleteGroupDialog
        groupId={groupId}
        title={title}
        open={deleteOpen}
        onClose={() => setDeleteOpen(false)}
        onDeleted={onClose}
      />
    </>
  );
}

function AvatarStack({ entries, size = 20 }: { entries: AvatarStackEntry[]; size?: number }) {
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
          size={size}
          className={index === 0 ? 'border-2 border-surface' : '-ml-1.5 border-2 border-surface'}
          {...(entry.avatarUrl === undefined ? {} : { avatarUrl: entry.avatarUrl })}
        />
      ))}
    </span>
  );
}

const JOIN_ERROR = "Couldn't join";

function memberById(info: GroupDetail | undefined): Map<string, GroupMember> {
  return new Map((info?.members ?? []).map((member) => [member.userId, member]));
}

function peopleOf(topic: TopicInfo, info: GroupDetail | undefined): AvatarStackEntry[] {
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

function aisOf(topic: TopicInfo): AvatarStackEntry[] {
  return (topic.ais ?? []).map((ai) => ({
    id: ai.id,
    name: ai.name,
    ...(ai.avatarUrl === undefined ? {} : { avatarUrl: ai.avatarUrl }),
  }));
}

function firstName(name: string): string {
  return name.split(' ')[0] ?? name;
}

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

function TopicGlyph({ topic }: { topic: TopicInfo }) {
  return (
    <span className="flex size-8 shrink-0 items-center justify-center rounded-[10px] border border-border bg-surface-raised text-[15px] font-semibold text-foreground/80">
      {topic.visibility === 'private' ? (
        <Lock className="size-3.5" role="img" aria-label="Private" />
      ) : (
        <span aria-hidden="true">#</span>
      )}
    </span>
  );
}

function TopicRow({
  chat,
  info,
  onOpen,
  showStack = false,
  trailing,
}: {
  chat: ChatSummary;
  info: GroupDetail | undefined;
  onOpen: (chatId: string) => void;
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
        <SectionLabel>Your topics</SectionLabel>
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
          <SectionLabel>Other topics</SectionLabel>
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

function TopicsSection({
  chat,
  onClose,
}: {
  /** `chat.id` keys the detail and `chat.groupId` is the group. */
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
