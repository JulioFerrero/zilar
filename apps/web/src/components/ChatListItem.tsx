import {
  formatListTime,
  markdownToPlain,
  previewBody,
  previewPrefix,
  shouldRenderMarkdown,
  type ChatSummary,
} from '@zilar/chat-core';
import { Megaphone, MoreHorizontal, Pin, VolumeX } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router';
import { AiBadge } from './AiBadge';
import { Avatar } from './Avatar';
import { ChatActionsMenu } from './ChatActionsMenu';
import { MessageTicks } from './MessageTicks';
import { useChatStore } from '@/store/ChatStoreProvider';
import { typingLabel } from '@/lib/format';
import { cn } from '@/lib/utils';

export function ChatListItem({
  chat,
  selected,
  isWide = true,
}: {
  chat: ChatSummary;
  selected: boolean;
  isWide?: boolean;
}) {
  const store = useChatStore();
  const last = chat.lastMessage;
  const options = { isGroup: chat.kind === 'group', currentUserId: store.currentUserId };
  const prefix = previewPrefix(last, options);
  const rawBody = previewBody(last);
  // Only an incoming AI reply is Markdown (shouldRenderMarkdown), in an AI
  // chat or in a group; your own message previews literally, exactly as its
  // bubble shows it.
  const body =
    last !== undefined && shouldRenderMarkdown(chat, last, store.currentUserId)
      ? markdownToPlain(rawBody)
      : rawBody;
  const own = last !== undefined && last.senderId === store.currentUserId;
  const typing = typingLabel(chat, store.typing[chat.id]?.names ?? []);
  const hasDraft = store.drafts[chat.id] !== undefined;
  // `writing…` is the AI's reveal; people keep D23's wording (with the new dot).
  const writing = chat.isAI && (hasDraft || typing !== undefined);
  const typingText = typing === undefined ? undefined : `${typing}…`;
  const [menuOpen, setMenuOpen] = useState(false);
  // T-0124: channels get a megaphone avatar badge and the CHANNEL tag (as in
  // the mockup); the header shows "N subscribers".
  const isChannel = chat.chatKind === 'channel';

  return (
    <div className="group relative">
      <Link
        to={`/c/${encodeURIComponent(chat.id)}`}
        aria-current={selected ? 'page' : undefined}
        className={cn(
          'flex items-center gap-3 transition-colors',
          isWide
            ? 'rounded-[12px] p-[10px] hover:bg-surface-raised hover:[--avatar-ring:var(--surface-raised)]'
            : 'px-4 py-2.5',
          selected &&
            isWide &&
            'bg-surface-raised shadow-[inset_0_1px_0_rgba(255,255,255,0.04)] [--avatar-ring:var(--surface-raised)]',
        )}
      >
        <Avatar
          id={chat.id}
          name={chat.title}
          avatarUrl={chat.avatarUrl}
          size={isWide ? 44 : 52}
          online={chat.online === true}
          ai={chat.isAI}
        />
        <div className={cn('min-w-0 flex-1', !isWide && 'border-b border-[#1a1a1a] pb-2.5')}>
          <div className="flex items-center gap-1.5">
            {chat.pinnedAt !== undefined && (
              <Pin aria-label="Pinned" className="size-3.5 shrink-0 text-subtle-foreground" />
            )}
            {isChannel && (
              <Megaphone
                aria-label="Channel"
                className="size-3.5 shrink-0 text-subtle-foreground"
              />
            )}
            <span className="truncate text-[14px] leading-5 font-semibold text-foreground">
              {chat.title}
            </span>
            {chat.isAI && <AiBadge />}
            {isChannel && (
              <span className="font-mono shrink-0 rounded-[5px] border border-badge-muted px-1 text-[10px] leading-[15px] text-muted-foreground">
                CHANNEL
              </span>
            )}
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
          </div>
          <div className="mt-0.5 flex items-center gap-1.5">
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
              <span
                className={cn(
                  'ml-auto flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full px-1.5 text-[11px] font-semibold',
                  chat.muted ? 'bg-badge-muted text-foreground' : 'key-primary',
                )}
                aria-label={`${chat.unread} unread`}
              >
                {chat.unread}
              </span>
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
          </div>
        </div>
      </Link>
      {menuOpen && <ChatActionsMenu chat={chat} onClose={() => setMenuOpen(false)} />}
    </div>
  );
}
