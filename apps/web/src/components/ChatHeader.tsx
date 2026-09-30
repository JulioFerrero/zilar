import type { ChatSummary } from '@galena/chat-core';
import { ArrowLeft, Lock, MoreVertical, Search } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { AiBadge } from './AiBadge';
import { Avatar } from './Avatar';
import { ChatPrefMenuItems, CHAT_MENU_ITEM_CLASS } from './ChatActionsMenu';
import { TypingDots } from './TypingDots';
import { IconButton } from './ui/icon-button';
import { chatSubtitle, typingLabel } from '@/lib/format';
import { useMediaQuery } from '@/lib/useMediaQuery';
import { useChatStore, useChatStoreApi } from '@/store/ChatStoreProvider';

export function ChatHeader({
  chat,
  onOpenAiPanel,
  onOpenGroupPanel,
  onOpenTopicPanel,
}: {
  chat: ChatSummary;
  onOpenAiPanel?: () => void;
  onOpenGroupPanel?: () => void;
  onOpenTopicPanel?: () => void;
}) {
  const navigate = useNavigate();
  const store = useChatStore();
  const storeApi = useChatStoreApi();
  const isWide = useMediaQuery('(min-width: 900px)');
  const names = store.typing[chat.id]?.names ?? [];
  const typing = typingLabel(chat, names);
  // An AI draft in flight reads `writing…`, the D24 wording (ui-style.md §5).
  const writing = chat.isAI && store.drafts[chat.id] !== undefined;
  const working = chat.isAI && chat.aiStatus === 'working';
  const subtitle = writing ? 'writing…' : (typing ?? chatSubtitle(chat, new Date()));
  const isTopic = chat.topic !== undefined;
  // One search path for the header button and the topic menu entry: scope the
  // list search to this chat and focus its box.
  const startChatSearch = (): void => {
    storeApi.getState().setSearchChat(chat.id);
    if (!isWide) {
      navigate('/');
    }
    // The list search box lives outside this view; focus it on the next
    // frame so the scope chip is already painted.
    window.setTimeout(() => window.dispatchEvent(new Event('galena:focus-search')), 0);
  };
  const groupTitle = chat.groupTitle ?? store.groupInfo(chat.id)?.title;
  const openPanel = onOpenTopicPanel ?? onOpenAiPanel ?? onOpenGroupPanel;
  const panelLabel = isTopic
    ? `Open ${chat.title} topic info`
    : chat.isAI
      ? `Open ${chat.title} settings`
      : `Open ${chat.title} info`;
  const [menuOpen, setMenuOpen] = useState(false);
  const [actionError, setActionError] = useState('');
  const [archiving, setArchiving] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // Esc closes the kebab menu.
  useEffect(() => {
    if (!menuOpen) {
      return;
    }
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        setMenuOpen(false);
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [menuOpen]);

  // A topic's Archive entry needs a manager; the entry hides until the
  // group detail loads and the role is known (see `TopicArchiveItem`).

  const title = (
    <>
      <div className="flex items-center gap-1.5">
        {isTopic && groupTitle !== undefined && groupTitle !== '' && (
          <span className="shrink-0 truncate text-[15px] leading-5 font-semibold text-muted-foreground">
            {groupTitle} <span aria-hidden="true">›</span>
          </span>
        )}
        <span className="truncate text-[15px] leading-5 font-semibold">{chat.title}</span>
        {chat.isAI && <AiBadge />}
        {isTopic && chat.topic?.visibility === 'private' && (
          <span className="flex shrink-0 items-center gap-1 rounded-full border border-border px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground">
            <Lock className="size-3" aria-hidden="true" />
            Private
          </span>
        )}
      </div>
      <div className="flex items-center gap-1 text-[12px] leading-4 text-muted-foreground">
        <span className="truncate">{subtitle}</span>
        {(working || typing !== undefined) && !writing && <TypingDots />}
      </div>
    </>
  );

  const archive = async (): Promise<void> => {
    setMenuOpen(false);
    setArchiving(true);
    setActionError('');
    try {
      await storeApi.getState().patchTopic(chat.id, { archived: true });
    } catch {
      setActionError('Could not archive the topic.');
    } finally {
      setArchiving(false);
    }
  };

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
      {openPanel !== undefined ? (
        <button
          type="button"
          aria-label={panelLabel}
          onClick={openPanel}
          className="min-w-0 flex-1 rounded-lg text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
        >
          {title}
        </button>
      ) : (
        <div className="min-w-0 flex-1">{title}</div>
      )}
      {actionError !== '' && (
        <span role="alert" className="hidden shrink-0 text-[12px] text-danger">
          {actionError}
        </span>
      )}
      <IconButton aria-label="Search in chat" onClick={startChatSearch}>
        <Search className="size-5" aria-hidden="true" />
      </IconButton>
      <div ref={menuRef} className="relative">
        <IconButton
          aria-label="Chat menu"
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          onClick={() => {
            setMenuOpen((value) => !value);
          }}
        >
          <MoreVertical className="size-5" aria-hidden="true" />
        </IconButton>
        {isTopic && menuOpen && (
          <>
            <button
              type="button"
              tabIndex={-1}
              aria-label="Close chat menu"
              onClick={() => setMenuOpen(false)}
              className="fixed inset-0 z-10 cursor-default"
            />
            <div
              role="menu"
              aria-label="Topic actions"
              className="absolute top-full right-0 z-20 mt-1 min-w-[180px] rounded-xl border border-border bg-popover py-1 shadow-lg"
            >
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setMenuOpen(false);
                  openPanel?.();
                }}
                className="flex w-full items-center px-3 py-2 text-left text-[15px] hover:bg-surface-raised focus-visible:bg-surface-raised focus-visible:outline-none"
              >
                Topic info
              </button>
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setMenuOpen(false);
                  storeApi.getState().setPinsPanel(chat.id);
                }}
                className="flex w-full items-center px-3 py-2 text-left text-[15px] hover:bg-surface-raised focus-visible:bg-surface-raised focus-visible:outline-none"
              >
                Pinned messages
              </button>
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setMenuOpen(false);
                  startChatSearch();
                }}
                className="flex w-full items-center px-3 py-2 text-left text-[15px] hover:bg-surface-raised focus-visible:bg-surface-raised focus-visible:outline-none"
              >
                Search
              </button>
              <ChatPrefMenuItems
                chat={chat}
                onDone={(failed) => {
                  if (!failed) {
                    setMenuOpen(false);
                  }
                }}
              >
                <TopicArchiveItem
                  chat={chat}
                  archiving={archiving}
                  onArchive={() => void archive()}
                />
              </ChatPrefMenuItems>
            </div>
          </>
        )}
        {!isTopic && menuOpen && (
          <>
            <button
              type="button"
              tabIndex={-1}
              aria-label="Close chat menu"
              onClick={() => setMenuOpen(false)}
              className="fixed inset-0 z-10 cursor-default"
            />
            <div
              role="menu"
              aria-label={`Actions for ${chat.title}`}
              className="absolute top-full right-0 z-20 mt-1 min-w-[196px] rounded-xl border border-border bg-popover py-1 shadow-lg"
            >
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setMenuOpen(false);
                  storeApi.getState().setPinsPanel(chat.id);
                }}
                className="flex w-full items-center px-3 py-2 text-left text-[15px] hover:bg-surface-raised focus-visible:bg-surface-raised focus-visible:outline-none"
              >
                Pinned messages
              </button>
              <ChatPrefMenuItems chat={chat} onDone={(failed) => !failed && setMenuOpen(false)} />
            </div>
          </>
        )}
      </div>
    </header>
  );
}

function TopicArchiveItem({
  chat,
  archiving,
  onArchive,
}: {
  chat: ChatSummary;
  archiving: boolean;
  onArchive: () => void;
}) {
  const store = useChatStore();
  const me = store.currentUserId;
  const info = store.groupInfo(chat.id);
  const myRole = info?.members.find((member) => member.userId === me)?.role;
  // Archive needs a manager (creator or group owner/admin); the detail may
  // not have loaded yet, so the entry hides until the role is known. Never
  // for General. It archives the topic for everyone (manager action), so it
  // sits last under a divider, below the per-user "Archive chat".
  if (chat.topic?.isGeneral === true) {
    return null;
  }
  if (myRole !== 'owner' && myRole !== 'admin') {
    return null;
  }
  return (
    <>
      <div aria-hidden="true" className="mx-3 my-1 border-t border-border" />
      <button
        type="button"
        role="menuitem"
        disabled={archiving}
        aria-label={`Archive topic ${chat.title} for everyone`}
        onClick={onArchive}
        className={CHAT_MENU_ITEM_CLASS}
      >
        {archiving ? 'Archiving…' : 'Archive topic for everyone'}
      </button>
    </>
  );
}
