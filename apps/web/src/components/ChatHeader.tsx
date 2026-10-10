import type { ChatSummary } from '@zilar/chat-core';
import { ArrowLeft, Lock, MoreVertical, Search } from 'lucide-react';
import { Data, Effect } from 'effect';
import { useState } from 'react';
import { useNavigate } from 'react-router';
import { AiBadge } from './AiBadge';
import { Avatar } from './Avatar';
import { ChatBackgroundDialog } from './ChatBackgroundDialog';
import { ChatPrefMenuItems } from './ChatActionsMenu';
import { TypingDots } from './TypingDots';
import { IconButton } from './ui/icon-button';
import { Menu, MenuItem } from './ui/menu';
import { runWeb } from '@/lib/effect/runtime';
import { failureOf, isWaiting, useAction } from '@/lib/effect/use-action';
import { chatSubtitle, typingLabel } from '@/lib/format';
import { useMediaQuery } from '@/lib/useMediaQuery';
import { useChatSelector, useChatStoreApi } from '@/store/ChatStoreProvider';

const ARCHIVE_ERROR = 'Could not archive the topic.';
const NO_NAMES: string[] = [];

/** The topic could not be archived (the store rejected the patch). */
class ArchiveFailed extends Data.TaggedError('ArchiveFailed') {}

export function ChatHeader({
  chat,
  onOpenAiPanel,
  onOpenGroupPanel,
  onOpenTopicPanel,
  onOpenMedia,
}: {
  chat: ChatSummary;
  onOpenAiPanel?: () => void;
  onOpenGroupPanel?: () => void;
  onOpenTopicPanel?: () => void;
  onOpenMedia?: () => void;
}) {
  const navigate = useNavigate();
  const storeApi = useChatStoreApi();
  const isWide = useMediaQuery('(min-width: 900px)');
  const typingNames = useChatSelector((s) => s.typing[chat.id]?.names);
  const names = typingNames ?? NO_NAMES;
  const hasDraft = useChatSelector((s) => s.drafts[chat.id] !== undefined);
  const storedGroupTitle = useChatSelector((s) => s.groupInfo(chat.id)?.title);
  const typing = typingLabel(chat, names);
  // An AI draft in flight reads `writing…`, the D24 wording (ui-style.md §5).
  const writing = chat.isAI && hasDraft;
  const working = chat.isAI && chat.aiStatus === 'working';
  const subtitle = writing ? 'writing…' : (typing ?? chatSubtitle(chat, new Date()));
  const isTopic = chat.topic !== undefined;
  // T-0124: a channel feed is one row (General keeps the group chat id), not
  // a topic row; the panel is the channel panel, like the group panel.
  const isChannel = chat.chatKind === 'channel';
  // One search path for the header button and the topic menu entry: scope the
  // list search to this chat and focus its box.
  const startChatSearch = (): void => {
    storeApi.getState().setSearchChat(chat.id);
    if (!isWide) {
      navigate('/');
    }
    // The list search box lives outside this view; focus it after a zero-delay
    // macrotask so the scope chip is already painted. The narrow-screen navigate
    // above unmounts this header, so the wait runs detached (runWeb), not in a
    // fiber that the unmount would interrupt.
    void runWeb(
      Effect.sleep(0).pipe(
        Effect.andThen(Effect.sync(() => window.dispatchEvent(new Event('zilar:focus-search')))),
      ),
    );
  };
  const groupTitle = chat.groupTitle ?? storedGroupTitle;
  const openPanel = onOpenTopicPanel ?? onOpenAiPanel ?? onOpenGroupPanel;
  const panelLabel = isTopic
    ? `Open ${chat.title} topic info`
    : chat.isAI
      ? `Open ${chat.title} settings`
      : isChannel
        ? `Open ${chat.title} channel info`
        : `Open ${chat.title} info`;
  const [menuOpen, setMenuOpen] = useState(false);
  const [backgroundOpen, setBackgroundOpen] = useState(false);
  // Archiving the topic for everyone: patch it, then leave the dead topic like
  // the topic panel does (to General when it exists, else `/`).
  const [archiveState, runArchive] = useAction<void, void, ArchiveFailed>(() =>
    Effect.tryPromise({
      try: () => storeApi.getState().patchTopic(chat.id, { archived: true }),
      catch: () => new ArchiveFailed(),
    }).pipe(
      Effect.flatMap((): Effect.Effect<string | undefined> => {
        const groupId = chat.groupId;
        if (groupId === undefined) {
          return Effect.succeed(undefined);
        }
        const known = storeApi
          .getState()
          .chats.find((entry) => entry.groupId === groupId && entry.topic?.isGeneral === true)?.id;
        return known !== undefined
          ? Effect.succeed(known)
          : Effect.promise(() => storeApi.getState().refreshGeneralTopic(groupId));
      }),
      Effect.tap((generalId) =>
        Effect.sync(() => {
          navigate(generalId === undefined ? '/' : `/c/${encodeURIComponent(generalId)}`);
        }),
      ),
    ),
  );
  const archiving = isWaiting(archiveState);
  const actionError = !archiving && failureOf(archiveState) !== undefined ? ARCHIVE_ERROR : '';

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
        {chat.visibility === 'public' && (
          <span className="font-mono shrink-0 rounded-[5px] border border-badge-muted px-1 text-[10px] leading-[15px] text-muted-foreground">
            PUBLIC
          </span>
        )}
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

  return (
    <header className="relative flex h-16 shrink-0 items-center gap-2.5 border-b border-divider bg-panel/85 px-4">
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
        <span
          role="alert"
          className="absolute top-full right-0 z-30 mt-1 max-w-[280px] rounded-xl border border-danger/40 bg-popover px-3 py-2 text-[12px] text-danger shadow-lg"
        >
          {actionError}
        </span>
      )}
      <IconButton aria-label="Search in chat" onClick={startChatSearch}>
        <Search className="size-5" aria-hidden="true" />
      </IconButton>
      <div className="relative">
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
        {isTopic && (
          <Menu
            open={menuOpen}
            onClose={() => setMenuOpen(false)}
            label="Topic actions"
            closeLabel="Close chat menu"
            className="top-full right-0 mt-1 min-w-[180px]"
          >
            <MenuItem
              onSelect={() => {
                setMenuOpen(false);
                openPanel?.();
              }}
            >
              Topic info
            </MenuItem>
            <MenuItem
              onSelect={() => {
                setMenuOpen(false);
                storeApi.getState().setPinsPanel(chat.id);
              }}
            >
              Pinned messages
            </MenuItem>
            <MenuItem
              onSelect={() => {
                setMenuOpen(false);
                onOpenMedia?.();
              }}
            >
              Media, files and links
            </MenuItem>
            <MenuItem
              onSelect={() => {
                setMenuOpen(false);
                startChatSearch();
              }}
            >
              Search
            </MenuItem>
            <MenuItem
              onSelect={() => {
                setMenuOpen(false);
                setBackgroundOpen(true);
              }}
            >
              Chat background
            </MenuItem>
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
                onArchive={() => {
                  setMenuOpen(false);
                  runArchive();
                }}
              />
            </ChatPrefMenuItems>
          </Menu>
        )}
        {!isTopic && (
          <Menu
            open={menuOpen}
            onClose={() => setMenuOpen(false)}
            label={`Actions for ${chat.title}`}
            closeLabel="Close chat menu"
            className="top-full right-0 mt-1 min-w-[196px]"
          >
            <MenuItem
              onSelect={() => {
                setMenuOpen(false);
                storeApi.getState().setPinsPanel(chat.id);
              }}
            >
              Pinned messages
            </MenuItem>
            <MenuItem
              onSelect={() => {
                setMenuOpen(false);
                onOpenMedia?.();
              }}
            >
              Media, files and links
            </MenuItem>
            <MenuItem
              onSelect={() => {
                setMenuOpen(false);
                setBackgroundOpen(true);
              }}
            >
              Chat background
            </MenuItem>
            <ChatPrefMenuItems chat={chat} onDone={(failed) => !failed && setMenuOpen(false)} />
          </Menu>
        )}
      </div>
      <ChatBackgroundDialog
        chat={chat}
        open={backgroundOpen}
        onClose={() => setBackgroundOpen(false)}
      />
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
  const me = useChatSelector((s) => s.currentUserId);
  const info = useChatSelector((s) => s.groupInfo(chat.id));
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
      <MenuItem
        disabled={archiving}
        ariaLabel={`Archive topic ${chat.title} for everyone`}
        onSelect={onArchive}
      >
        {archiving ? 'Archiving…' : 'Archive topic for everyone'}
      </MenuItem>
    </>
  );
}
