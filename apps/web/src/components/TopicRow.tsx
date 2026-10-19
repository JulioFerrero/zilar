import {
  formatListTime,
  topicActivityView,
  typingLabel,
  type ChatSummary,
  type UiMessage,
} from '@zilar/chat-core';
import { Lock, Pin, VolumeX } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router';
import { AiActivityMarks } from './topic/AiActivityMarks';
import { RowActions } from './chatList/RowActions';
import { chatRowPreview } from './ChatListItem';
import { cn } from '@/lib/utils';
import { useBlockedJids } from '@/lib/blockedJids';
import { useChatSelector } from '@/store/ChatStoreProvider';
import { MessageTicks } from './MessageTicks';
import { AiBadge } from './AiBadge';
import { PreviewLine } from './chatList/PreviewLine';
import { Badge } from './ui/badge';

const NO_MESSAGES: UiMessage[] = [];
const NO_NAMES: string[] = [];

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
