import {
  formatListTime,
  topicActivityView,
  typingLabel,
  type ChatSummary,
  type UiMessage,
} from '@zilar/chat-core';
import { ChevronDown, ChevronRight, Lock, Pin, Plus, VolumeX } from 'lucide-react';
import { memo, useState } from 'react';
import { Link } from 'react-router';
import { cn } from '@/lib/utils';
import { useBlockedJids } from '@/lib/blockedJids';
import { useChatSelector } from '@/store/ChatStoreProvider';
import { AiBadge } from '../AiBadge';
import { chatRowPreview } from '../ChatListItem';
import { EntityAvatar } from '../EntityAvatar';
import { MessageTicks } from '../MessageTicks';
import { AiActivityMarks } from '../topic/AiActivityMarks';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { PreviewLine } from './PreviewLine';
import { RowActions } from './RowActions';

export const GroupHeaderRow = memo(function GroupHeaderRow({
  groupTitle,
  groupId,
  chat,
  topics,
  selectedId,
  collapsed,
  onToggleCollapse,
  archivedOpen,
  onToggleArchived,
  isWide = true,
  onOpenNewTopic,
}: {
  groupTitle: string;
  groupId: string;
  chat: ChatSummary;
  topics: ChatSummary[];
  selectedId: string | undefined;
  collapsed: boolean;
  onToggleCollapse: (groupId: string) => void;
  archivedOpen: boolean;
  onToggleArchived: (groupId: string) => void;
  isWide?: boolean;
  onOpenNewTopic?: (chatId: string) => void;
}) {
  // The dialog and the store resolve the group from a chat row id, not the
  // group id: pass the General topic's row id (every group has one).
  const newTopicChatId = (topics.find((topic) => topic.topic?.isGeneral === true) ?? topics[0])?.id;
  const active = topics.filter(
    (topic) => topic.topic?.archived !== true && topic.archived !== true,
  );
  // Manager-archived topics (for everyone) and per-user archived ones (hidden
  // only for the viewer) share the same "Archived (n)" section, never two toggles.
  const archived = topics.filter(
    (topic) => topic.topic?.archived === true || topic.archived === true,
  );
  const unread = topics.reduce((total, topic) => total + (topic.muted ? 0 : topic.unread), 0);
  const mutedUnread = topics.reduce((total, topic) => total + topic.unread, 0) - unread;
  const newest = topics
    .map((topic) => topic.lastMessage?.createdAt.getTime() ?? Number.NEGATIVE_INFINITY)
    .reduce((best, time) => Math.max(best, time), Number.NEGATIVE_INFINITY);
  const selectedInside = topics.some((topic) => topic.id === selectedId);
  const Chevron = collapsed ? ChevronRight : ChevronDown;
  const showNewTopic = onOpenNewTopic !== undefined && newTopicChatId !== undefined;

  return (
    <div className="flex flex-col">
      <div
        className={cn(
          'group relative flex items-center gap-3',
          isWide ? 'rounded-[12px] p-[10px]' : 'px-4 py-2.5',
          selectedInside && collapsed && isWide && 'bg-surface-raised',
        )}
      >
        <button
          type="button"
          onClick={() => onToggleCollapse(groupId)}
          aria-expanded={!collapsed}
          aria-label={`${collapsed ? 'Expand' : 'Collapse'} ${groupTitle}, ${active.length} topics`}
          className="flex min-w-0 flex-1 items-center gap-3 rounded-[12px] text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
        >
          {/* Seed the orb from the group title so the header matches the group
           * everywhere; the picture stays the row's.
           */}
          <EntityAvatar chat={{ ...chat, title: groupTitle }} size={isWide ? 44 : 52} />
          <span className="min-w-0 flex-1">
            <span className="flex items-center gap-1.5">
              <span className="truncate text-[14px] leading-5 font-semibold text-foreground">
                {groupTitle}
              </span>
              <Chevron className="size-4 shrink-0 text-subtle-foreground" aria-hidden="true" />
              <span className="ml-auto flex shrink-0 items-center gap-2 pl-1.5">
                {newest !== Number.NEGATIVE_INFINITY && (
                  <span
                    className={cn(
                      'font-mono text-[11px] text-subtle-foreground transition-opacity',
                      showNewTopic && 'group-hover:opacity-0 group-focus-within:opacity-0',
                    )}
                  >
                    {formatListTime(new Date(newest), new Date())}
                  </span>
                )}
              </span>
            </span>
            <span className="mt-0.5 flex items-center gap-1.5">
              <span className="truncate text-[13px] leading-5 text-muted-foreground">
                {active.length} {active.length === 1 ? 'topic' : 'topics'}
              </span>
              {unread > 0 && (
                <Badge
                  count={unread}
                  labelSuffix={`unread in ${groupTitle}`}
                  className="ml-auto shrink-0"
                />
              )}
              {unread === 0 && mutedUnread > 0 && (
                <Badge
                  count={mutedUnread}
                  muted
                  labelSuffix={`unread in ${groupTitle}`}
                  className="ml-auto shrink-0"
                />
              )}
            </span>
          </span>
        </button>
        {onOpenNewTopic !== undefined && newTopicChatId !== undefined && (
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            onClick={() => onOpenNewTopic(newTopicChatId)}
            aria-label={`New topic in ${groupTitle}`}
            title={`New topic in ${groupTitle}`}
            className={cn(
              'pointer-events-none absolute top-1.5 size-6 shrink-0 rounded-full text-muted-foreground opacity-0 transition-opacity group-hover:pointer-events-auto group-hover:opacity-100 focus-visible:pointer-events-auto focus-visible:opacity-100',
              isWide ? 'right-[10px]' : 'right-4',
            )}
          >
            <Plus className="size-4" aria-hidden="true" />
          </Button>
        )}
      </div>
      {!collapsed && (
        <div className="ml-5 border-l border-border pl-1.5">
          {active.map((topic) => (
            <TopicRow
              key={topic.id}
              chat={topic}
              groupTitle={groupTitle}
              selected={topic.id === selectedId}
              isWide={isWide}
            />
          ))}
          {archived.length > 0 && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              aria-expanded={archivedOpen}
              onClick={() => onToggleArchived(groupId)}
              className="w-full justify-start text-muted-foreground"
            >
              Archived ({archived.length})
            </Button>
          )}
          {archivedOpen &&
            archived.map((topic) => (
              <TopicRow
                key={topic.id}
                chat={topic}
                groupTitle={groupTitle}
                selected={topic.id === selectedId}
                isWide={isWide}
              />
            ))}
        </div>
      )}
    </div>
  );
});

const NO_MESSAGES: UiMessage[] = [];
const NO_NAMES: string[] = [];

function TopicRow({
  chat,
  groupTitle,
  selected,
  isWide = true,
}: {
  chat: ChatSummary;
  groupTitle: string;
  selected: boolean;
  isWide?: boolean;
}) {
  const currentUserId = useChatSelector((s) => s.currentUserId);
  const messages = useChatSelector((s) => s.messagesByChat[chat.id]) ?? NO_MESSAGES;
  const typingNames = useChatSelector((s) => s.typing[chat.id]?.names) ?? NO_NAMES;
  const hasDraft = useChatSelector((s) => s.drafts[chat.id] !== undefined);
  const last = chat.lastMessage;
  const blockedJids = useBlockedJids();
  const { prefix, body, KindIcon } = chatRowPreview(chat, currentUserId, messages, blockedJids);
  const own = last !== undefined && last.senderId === currentUserId;
  const typing = typingLabel(chat, typingNames);
  const writing = chat.isAI && (hasDraft || typing !== undefined);
  const typingText = typing === undefined ? undefined : `${typing}…`;
  const isPrivate = chat.topic?.visibility === 'private';
  const glyph = chat.topic?.glyph ?? chat.title.charAt(0).toUpperCase() ?? '?';
  const topic = chat.topic;
  const activity =
    topic === undefined
      ? undefined
      : topicActivityView(topic.activity, topic.doneAt, topic.isGeneral);
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <div className="group relative">
      <Link
        to={`/c/${encodeURIComponent(chat.id)}`}
        data-topic-row=""
        aria-current={selected ? 'page' : undefined}
        aria-label={`${groupTitle} ${chat.title}${isPrivate ? ', private topic' : ''}`}
        className={cn(
          'flex items-center gap-2.5 transition-colors',
          isWide
            ? 'rounded-[12px] py-[8px] pr-[10px] pl-[10px] hover:bg-surface-raised hover:[--avatar-ring:var(--surface-raised)]'
            : 'px-4 py-2.5',
          selected &&
            isWide &&
            'raised-segment bg-surface-raised [--avatar-ring:var(--surface-raised)]',
        )}
      >
        <span
          aria-hidden="true"
          className="flex size-9 shrink-0 items-center justify-center rounded-[10px] border border-edge bg-gradient-to-b from-[#2c2c2c] to-[#151515] text-[15px] font-semibold text-foreground shadow-[inset_0_1px_0_rgba(255,255,255,0.16),inset_0_-1px_0_rgba(0,0,0,0.65),0_1px_0_rgba(0,0,0,0.95),0_3px_6px_-1px_rgba(0,0,0,0.75)]"
        >
          {glyph}
        </span>
        <span className={cn('min-w-0 flex-1', !isWide && 'border-b border-border pb-2.5')}>
          <span className="flex items-center gap-1.5">
            {chat.pinnedAt !== undefined && (
              <Pin aria-label="Pinned" className="size-3.5 shrink-0 text-subtle-foreground" />
            )}
            <span
              className={cn(
                'truncate text-[14px] leading-5 font-semibold',
                activity?.done === true ? 'text-muted-foreground' : 'text-foreground',
              )}
            >
              {chat.title}
            </span>
            {isPrivate && (
              <Lock
                aria-label="Private topic"
                className="size-3.5 shrink-0 text-subtle-foreground"
              />
            )}
            {chat.isAI && <AiBadge />}
            <span className="ml-auto flex shrink-0 items-center gap-2 pl-1.5">
              {topic !== undefined && (
                <AiActivityMarks
                  activity={topic.activity}
                  doneAt={topic.doneAt}
                  isGeneral={topic.isGeneral}
                />
              )}
              {chat.muted && (
                <VolumeX aria-label="Muted" className="size-4 text-subtle-foreground" />
              )}
              {last !== undefined && (
                <span className="font-mono text-[11px] text-subtle-foreground transition-opacity group-hover:opacity-0 group-focus-within:opacity-0">
                  {formatListTime(last.createdAt, new Date())}
                </span>
              )}
            </span>
          </span>
          <span className="mt-0.5 flex items-center gap-1.5">
            {writing ? (
              <span className="flex min-w-0 items-center gap-1.5 text-[13px] text-muted-foreground">
                <span className="pulse-dot size-1.5 shrink-0 rounded-full bg-muted-foreground" />
                <span className="truncate">writing…</span>
              </span>
            ) : typingText !== undefined ? (
              <span className="flex min-w-0 items-center gap-1.5 text-[13px] text-muted-foreground">
                <span className="pulse-dot size-1.5 shrink-0 rounded-full bg-muted-foreground" />
                <span className="truncate">{typingText}</span>
              </span>
            ) : (
              <PreviewLine KindIcon={KindIcon} prefix={prefix} body={body} />
            )}
            {chat.unread > 0 ? (
              <Badge
                count={chat.unread}
                muted={chat.muted}
                labelSuffix="unread"
                className="ml-auto shrink-0"
              />
            ) : (
              own &&
              last !== undefined && (
                <span className="ml-auto flex shrink-0 items-center text-subtle-foreground">
                  <MessageTicks status={last.status} />
                </span>
              )
            )}
          </span>
        </span>
      </Link>
      <RowActions chat={chat} isWide={isWide} menuOpen={menuOpen} setMenuOpen={setMenuOpen} />
    </div>
  );
}
