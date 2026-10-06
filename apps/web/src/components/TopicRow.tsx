import type { ChatSummary, UiMessage } from '@zilar/chat-core';
import { ChevronDown, ChevronRight, Lock, MoreHorizontal, Pin, Plus, VolumeX } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router';
import { Avatar } from './Avatar';
import { ChatActionsMenu } from './ChatActionsMenu';
import { cn } from '@/lib/utils';
import { formatListTime, previewBody, previewPrefix, shouldRenderMarkdown } from '@zilar/chat-core';
import { markdownToPlain } from '@zilar/chat-core';
import { useBlockedJids } from '@/lib/blockedJids';
import { typingLabel } from '@/lib/format';
import { previewMessage } from '@/lib/preview-message';
import { useChatStore } from '@/store/ChatStoreProvider';
import { MessageTicks } from './MessageTicks';
import { AiBadge } from './AiBadge';
import { Badge } from './ui/badge';
import { Button } from './ui/button';

function rowPreview(
  chat: ChatSummary,
  currentUserId: string,
  messages: readonly UiMessage[],
  blocked: ReadonlySet<string>,
): { prefix: string; body: string } {
  const preview = previewMessage(chat, messages, blocked, currentUserId);
  const options = { isGroup: chat.kind === 'group', currentUserId };
  const prefix = previewPrefix(preview, options);
  const rawBody = previewBody(preview);
  const body =
    preview !== undefined && shouldRenderMarkdown(chat, preview, currentUserId)
      ? markdownToPlain(rawBody)
      : rawBody;
  return { prefix, body };
}

export function TopicRow({
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
  const store = useChatStore();
  const last = chat.lastMessage;
  const blockedJids = useBlockedJids();
  const { prefix, body } = rowPreview(
    chat,
    store.currentUserId,
    store.messages(chat.id),
    blockedJids,
  );
  const own = last !== undefined && last.senderId === store.currentUserId;
  const typing = typingLabel(chat, store.typing[chat.id]?.names ?? []);
  const hasDraft = store.drafts[chat.id] !== undefined;
  const writing = chat.isAI && (hasDraft || typing !== undefined);
  const typingText = typing === undefined ? undefined : `${typing}…`;
  const isPrivate = chat.topic?.visibility === 'private';
  const glyph = chat.topic?.glyph ?? chat.title.charAt(0).toUpperCase() ?? '?';
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
        <span className={cn('min-w-0 flex-1', !isWide && 'border-b border-[#1a1a1a] pb-2.5')}>
          <span className="flex items-center gap-1.5">
            {chat.pinnedAt !== undefined && (
              <Pin aria-label="Pinned" className="size-3.5 shrink-0 text-subtle-foreground" />
            )}
            <span className="truncate text-[14px] leading-5 font-semibold text-foreground">
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
              {chat.muted && (
                <VolumeX aria-label="Muted" className="size-4 text-subtle-foreground" />
              )}
              {last !== undefined && (
                <span className="font-mono text-[11px] text-subtle-foreground">
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
              <span className="truncate text-[13px] leading-5 text-muted-foreground">
                {prefix.length > 0 && <span className="text-[#d4d4d4]">{prefix}</span>}
                {body}
              </span>
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
            <button
              type="button"
              aria-label={`Chat actions for ${chat.title}`}
              aria-haspopup="menu"
              aria-expanded={menuOpen}
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                setMenuOpen((value) => !value);
              }}
              className="shrink-0 rounded-md p-1 text-subtle-foreground opacity-0 transition-opacity group-hover:opacity-100 hover:text-foreground focus-visible:opacity-100 focus-visible:outline-none"
            >
              <MoreHorizontal className="size-4" aria-hidden="true" />
            </button>
          </span>
        </span>
      </Link>
      {menuOpen && <ChatActionsMenu chat={chat} onClose={() => setMenuOpen(false)} />}
    </div>
  );
}

/**
 * One group as a collapsible header row with its topics nested underneath in
 * a 1 px left rail (T-0111): the avatar, the title, "N topics", the
 * aggregated unread, and the newest message time. The chevron toggles the
 * collapse (remembered per group in localStorage); collapsed shows only the
 * header. Archived topics hide under an "Archived (n)" toggle.
 */
export function GroupHeaderRow({
  groupTitle,
  groupId,
  avatarUrl,
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
  avatarUrl?: string | undefined;
  topics: ChatSummary[];
  selectedId: string | undefined;
  collapsed: boolean;
  onToggleCollapse: () => void;
  archivedOpen: boolean;
  onToggleArchived: () => void;
  isWide?: boolean;
  onOpenNewTopic?: () => void;
}) {
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

  return (
    <div className="flex flex-col">
      <div
        className={cn(
          'flex items-center gap-3',
          isWide ? 'rounded-[12px] p-[10px]' : 'px-4 py-2.5',
          selectedInside && collapsed && isWide && 'bg-surface-raised',
        )}
      >
        <button
          type="button"
          onClick={onToggleCollapse}
          aria-expanded={!collapsed}
          aria-label={`${collapsed ? 'Expand' : 'Collapse'} ${groupTitle}, ${active.length} topics`}
          className="flex min-w-0 flex-1 items-center gap-3 rounded-[12px] text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
        >
          <Avatar id={groupId} name={groupTitle} size={isWide ? 44 : 52} avatarUrl={avatarUrl} />
          <span className="min-w-0 flex-1">
            <span className="flex items-center gap-1.5">
              <span className="truncate text-[14px] leading-5 font-semibold text-foreground">
                {groupTitle}
              </span>
              <Chevron className="size-4 shrink-0 text-subtle-foreground" aria-hidden="true" />
              <span className="ml-auto flex shrink-0 items-center gap-2 pl-1.5">
                {newest !== Number.NEGATIVE_INFINITY && (
                  <span className="font-mono text-[11px] text-subtle-foreground">
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
        {onOpenNewTopic !== undefined && (
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            onClick={onOpenNewTopic}
            aria-label={`New topic in ${groupTitle}`}
            title={`New topic in ${groupTitle}`}
            className="shrink-0 rounded-full text-muted-foreground"
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
            <button
              type="button"
              onClick={onToggleArchived}
              aria-expanded={archivedOpen}
              className="w-full rounded-[12px] px-2.5 py-1.5 text-left text-[13px] text-muted-foreground hover:bg-surface-raised focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
            >
              Archived ({archived.length})
            </button>
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
}
