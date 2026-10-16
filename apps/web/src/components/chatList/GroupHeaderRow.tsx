import { formatListTime, type ChatSummary } from '@zilar/chat-core';
import { ChevronDown, ChevronRight, Plus } from 'lucide-react';
import { memo } from 'react';
import { cn } from '@/lib/utils';
import { EntityAvatar } from '../EntityAvatar';
import { TopicRow } from '../TopicRow';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';

/**
 * One group as a collapsible header row with its topics nested underneath in
 * a 1 px left rail (T-0111): the avatar, the title, "N topics", the
 * aggregated unread, and the newest message time. The chevron toggles the
 * collapse (remembered per group in localStorage); collapsed shows only the
 * header. Archived topics hide under an "Archived (n)" toggle.
 */
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
  /** The General topic's row: the group header's picture and id. */
  chat: ChatSummary;
  topics: ChatSummary[];
  selectedId: string | undefined;
  collapsed: boolean;
  onToggleCollapse: (groupId: string) => void;
  archivedOpen: boolean;
  onToggleArchived: (groupId: string) => void;
  isWide?: boolean;
  /** Opens the new-topic dialog for this group; the value is a chat row id. */
  onOpenNewTopic?: (chatId: string) => void;
}) {
  // The dialog and the store resolve the group from a chat row id, not the
  // group id: pass the General topic's row id (every group has one since
  // T-1090). The first row covers a legacy group whose topics have not loaded.
  const newTopicChatId = (topics.find((topic) => topic.topic?.isGeneral === true) ?? topics[0])?.id;
  const active = topics.filter(
    (topic) => topic.topic?.archived !== true && topic.archived !== true,
  );
  // Archived topics hide under the "Archived (n)" toggle: manager-archived
  // ones (archived for everyone) and per-user archived ones (hidden only for
  // the viewer, T-0113) share the same section — never two toggles.
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
  // The "+" (new topic) button overlays the time on hover/focus, like the row
  // "more" button: the time hides while the button is shown.
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
          {/* The row's `chat` is the General topic's row, whose title is the
              topic name; seed the orb from the group title so the header
              matches the group everywhere (T-1334). The picture stays the
              row's. */}
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
