import { formatListTime, previewBody, previewPrefix, type ChatSummary } from '@galena/chat-core';
import { VolumeX } from 'lucide-react';
import { Link } from 'react-router';
import { AiBadge } from './AiBadge';
import { Avatar } from './Avatar';
import { MessageTicks } from './MessageTicks';
import { useChatStore } from '@/store/ChatStoreProvider';
import { cn } from '@/lib/utils';

export function ChatListItem({ chat, selected }: { chat: ChatSummary; selected: boolean }) {
  const store = useChatStore();
  const last = chat.lastMessage;
  const options = { isGroup: chat.kind === 'group', currentUserId: store.currentUserId };
  const prefix = previewPrefix(last, options);
  const body = previewBody(last);
  const own = last !== undefined && last.senderId === store.currentUserId;

  return (
    <Link
      to={`/c/${chat.id}`}
      aria-current={selected ? 'page' : undefined}
      className={cn(
        'flex h-[72px] items-center gap-3 px-2.5 transition-colors',
        selected ? 'bg-list-active text-list-active-foreground' : 'hover:bg-list-hover',
      )}
    >
      <Avatar
        id={chat.id}
        name={chat.title}
        avatarUrl={chat.avatarUrl}
        size={54}
        online={chat.online === true}
      />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span
            className={cn('truncate text-[16px] leading-5 font-semibold', selected && 'text-white')}
          >
            {chat.title}
          </span>
          {chat.isAI && <AiBadge />}
          {chat.muted && (
            <VolumeX
              aria-label="Muted"
              className={cn(
                'size-4 shrink-0',
                selected ? 'text-white/80' : 'text-muted-foreground',
              )}
            />
          )}
          {last !== undefined && (
            <span
              className={cn(
                'ml-auto shrink-0 text-[12px]',
                selected ? 'text-white/80' : 'text-muted-foreground',
              )}
            >
              {formatListTime(last.createdAt, new Date())}
            </span>
          )}
        </div>
        <div className="mt-0.5 flex items-center gap-1.5">
          <span
            className={cn(
              'truncate text-[15px] leading-5',
              selected ? 'text-white/85' : 'text-muted-foreground',
            )}
          >
            {prefix.length > 0 && (
              <span className={selected ? 'text-white' : 'text-foreground'}>{prefix}</span>
            )}
            {body}
          </span>
          {chat.unread > 0 ? (
            <span
              className={cn(
                'ml-auto shrink-0 rounded-full px-1.5 text-[12px] leading-[18px] font-semibold text-white',
                chat.muted ? 'bg-badge-muted' : 'bg-accent',
              )}
              aria-label={`${chat.unread} unread`}
            >
              {chat.unread}
            </span>
          ) : (
            own &&
            last !== undefined && (
              <span
                className={cn(
                  'ml-auto flex shrink-0 items-center',
                  selected ? 'text-white/80' : 'text-muted-foreground',
                )}
              >
                <MessageTicks status={last.status} />
              </span>
            )
          )}
        </div>
      </div>
    </Link>
  );
}
