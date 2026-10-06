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
import { Badge } from './ui/badge';
import { Button } from './ui/button';
import { useChatStore } from '@/store/ChatStoreProvider';
import { useBlockedJids } from '@/lib/blockedJids';
import { typingLabel } from '@/lib/format';
import { previewMessage } from '@/lib/preview-message';
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
  const blockedJids = useBlockedJids();
  const preview = previewMessage(chat, store.messages(chat.id), blockedJids, store.currentUserId);
  const options = { isGroup: chat.kind === 'group', currentUserId: store.currentUserId };
  const prefix = previewPrefix(preview, options);
  const rawBody = previewBody(preview);
  // Only an incoming AI reply is Markdown (shouldRenderMarkdown), in an AI
  // chat or in a group; your own message previews literally, exactly as its
  // bubble shows it.
  const body =
    preview !== undefined && shouldRenderMarkdown(chat, preview, store.currentUserId)
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
  // T-0164: public groups and channels get a PUBLIC tag next to the title,
  // in the same tag style.
  const isChannel = chat.chatKind === 'channel';
  const isPublic = chat.visibility === 'public';

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
            {isPublic && (
              <span className="font-mono shrink-0 rounded-[5px] border border-badge-muted px-1 text-[10px] leading-[15px] text-muted-foreground">
                PUBLIC
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
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label={`Chat actions for ${chat.title}`}
              aria-haspopup="menu"
              aria-expanded={menuOpen}
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                setMenuOpen((value) => !value);
              }}
              className="size-6 shrink-0 text-subtle-foreground opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
            >
              <MoreHorizontal className="size-4" aria-hidden="true" />
            </Button>
          </div>
        </div>
      </Link>
      {menuOpen && <ChatActionsMenu chat={chat} onClose={() => setMenuOpen(false)} />}
    </div>
  );
}
