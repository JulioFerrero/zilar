import type { ChatSummary } from '@galena/chat-core';
import { ArrowLeft, MoreVertical, Search } from 'lucide-react';
import { useNavigate } from 'react-router';
import { AiBadge } from './AiBadge';
import { Avatar } from './Avatar';
import { TypingDots } from './TypingDots';
import { chatSubtitle, typingLabel } from '@/lib/format';
import { useChatStore } from '@/store/ChatStoreProvider';
import { cn } from '@/lib/utils';

export function ChatHeader({ chat }: { chat: ChatSummary }) {
  const navigate = useNavigate();
  const store = useChatStore();
  const names = store.typing[chat.id]?.names ?? [];
  const typing = typingLabel(chat, names);
  const subtitle = typing ?? chatSubtitle(chat, new Date());
  const working = chat.isAI && chat.aiStatus === 'working';

  return (
    <header className="flex h-14 shrink-0 items-center gap-2.5 border-b border-divider bg-background px-2">
      <button
        type="button"
        aria-label="Back to chats"
        onClick={() => navigate('/')}
        className="flex size-9 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-list-hover wide:hidden"
      >
        <ArrowLeft className="size-5" aria-hidden="true" />
      </button>
      <Avatar
        id={chat.id}
        name={chat.title}
        avatarUrl={chat.avatarUrl}
        size={42}
        online={chat.online === true}
      />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="truncate text-[16px] leading-5 font-semibold">{chat.title}</span>
          {chat.isAI && <AiBadge />}
        </div>
        <div
          className={cn(
            'flex items-center gap-1 text-[14px] leading-5 text-muted-foreground',
            typing !== undefined && 'text-accent',
          )}
        >
          <span className="truncate">{subtitle}</span>
          {(working || typing !== undefined) && <TypingDots />}
        </div>
      </div>
      <button
        type="button"
        aria-label="Search in chat"
        className="flex size-9 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-list-hover"
      >
        <Search className="size-5" aria-hidden="true" />
      </button>
      <button
        type="button"
        aria-label="Chat menu"
        className="flex size-9 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-list-hover"
      >
        <MoreVertical className="size-5" aria-hidden="true" />
      </button>
    </header>
  );
}
