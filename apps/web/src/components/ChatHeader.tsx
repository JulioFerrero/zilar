import type { ChatSummary } from '@galena/chat-core';
import { ArrowLeft, MoreVertical, Search } from 'lucide-react';
import { useNavigate } from 'react-router';
import { AiBadge } from './AiBadge';
import { Avatar } from './Avatar';
import { TypingDots } from './TypingDots';
import { IconButton } from './ui/icon-button';
import { chatSubtitle, typingLabel } from '@/lib/format';
import { useChatStore } from '@/store/ChatStoreProvider';

export function ChatHeader({
  chat,
  onOpenAiPanel,
}: {
  chat: ChatSummary;
  onOpenAiPanel?: () => void;
}) {
  const navigate = useNavigate();
  const store = useChatStore();
  const names = store.typing[chat.id]?.names ?? [];
  const typing = typingLabel(chat, names);
  // An AI draft in flight reads `writing…`, the D24 wording (ui-style.md §5).
  const writing = chat.isAI && store.drafts[chat.id] !== undefined;
  const working = chat.isAI && chat.aiStatus === 'working';
  const subtitle = writing ? 'writing…' : (typing ?? chatSubtitle(chat, new Date()));

  const title = (
    <>
      <div className="flex items-center gap-1.5">
        <span className="truncate text-[15px] leading-5 font-semibold">{chat.title}</span>
        {chat.isAI && <AiBadge />}
      </div>
      <div className="flex items-center gap-1 text-[12px] leading-4 text-muted-foreground">
        <span className="truncate">{subtitle}</span>
        {(working || typing !== undefined) && !writing && <TypingDots />}
      </div>
    </>
  );

  return (
    <header className="flex h-16 shrink-0 items-center gap-2.5 border-b border-divider bg-panel/85 px-4">
      <IconButton aria-label="Back to chats" onClick={() => navigate('/')} className="wide:hidden">
        <ArrowLeft className="size-5" aria-hidden="true" />
      </IconButton>
      <Avatar
        id={chat.id}
        name={chat.title}
        avatarUrl={chat.avatarUrl}
        size={36}
        online={chat.online === true}
        ai={chat.isAI}
      />
      {chat.isAI && onOpenAiPanel !== undefined ? (
        <button
          type="button"
          aria-label={`Open ${chat.title} settings`}
          onClick={onOpenAiPanel}
          className="min-w-0 flex-1 rounded-lg text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
        >
          {title}
        </button>
      ) : (
        <div className="min-w-0 flex-1">{title}</div>
      )}
      <IconButton aria-label="Search in chat">
        <Search className="size-5" aria-hidden="true" />
      </IconButton>
      <IconButton aria-label="Chat menu">
        <MoreVertical className="size-5" aria-hidden="true" />
      </IconButton>
    </header>
  );
}
