import type { ChatSummary } from '@zilar/chat-core';
import {
  ArrowLeft,
  Bookmark,
  Globe,
  Images,
  Info,
  Lock,
  MoreVertical,
  Palette,
  Search,
  Users,
} from 'lucide-react';
import { Data, Effect } from 'effect';
import { useState } from 'react';
import { useNavigate } from 'react-router';
import { AiBadge } from './AiBadge';
import { EntityAvatar } from './EntityAvatar';
import { ChatBackgroundDialog } from './ChatBackgroundDialog';
import { ChatPrefMenuItems } from './ChatActionsMenu';
import { ConfirmDialog } from './ConfirmDialog';
import { TypingDots } from './TypingDots';
import { AisHereKey } from './topic/AisHereKey';
import { IconButton } from './ui/icon-button';
import { Menu, MenuItem } from './ui/menu';
import { statusLabel } from '@/components/chatList/rowsSelector';
import { failureOf, isWaiting, useAction } from '@/lib/effect/use-action';
import { chatSubtitle, typingLabel } from '@/lib/format';
import { useChatSelector, useChatStoreApi } from '@/store/ChatStoreProvider';

const ARCHIVE_ERROR = 'Could not archive the topic.';
const NO_NAMES: string[] = [];

/**
 * T-1406: client-core writes a status beside the typing names; the web store's
 * `TypingState` (outside this task's Allowed files) types only `names`, so the
 * header reads the status through a widened record.
 */
type TypingStatus = { status?: string };

/** The topic could not be archived (the store rejected the patch). */
class ArchiveFailed extends Data.TaggedError('ArchiveFailed') {}

export function ChatHeader({
  chat,
  onSearch,
  onOpenAiPanel,
  onOpenGroupPanel,
  onOpenTopicPanel,
  onOpenContactPanel,
  onOpenMedia,
}: {
  chat: ChatSummary;
  onSearch: () => void;
  onOpenAiPanel?: () => void;
  onOpenGroupPanel?: () => void;
  onOpenTopicPanel?: () => void;
  onOpenContactPanel?: () => void;
  onOpenMedia?: () => void;
}) {
  const navigate = useNavigate();
  const storeApi = useChatStoreApi();
  const typingNames = useChatSelector((s) => s.typing[chat.id]?.names);
  const names = typingNames ?? NO_NAMES;
  // T-1452 (WUX-14): the connection line lives in the header like mobile
  // (T-1192/MUX-15) and Telegram, not above the composer.
  const connection = statusLabel(useChatSelector((s) => s.status));
  const aiStatusText = useChatSelector(
    (s) => (s.typing[chat.id] as TypingStatus | undefined)?.status,
  );
  const hasDraft = useChatSelector((s) => s.drafts[chat.id] !== undefined);
  const storedGroupTitle = useChatSelector((s) => s.groupInfo(chat.id)?.title);
  const typing = typingLabel(chat, names);
  // An AI draft in flight reads `writing…`, the D24 wording (ui-style.md §5).
  const writing = chat.isAI && hasDraft;
  const working = chat.isAI && chat.aiStatus === 'working';
  // T-1406: while the AI carries a status it reads next to the dots, e.g.
  // "Searching the web…"; with no status the line keeps the plain dots.
  const aiLine = aiStatusText === undefined ? undefined : `${aiStatusText}…`;
  const subtitle =
    connection ?? aiLine ?? (writing ? 'writing…' : (typing ?? chatSubtitle(chat, new Date())));
  const isTopic = chat.topic !== undefined;
  // T-0124: a channel feed is one row (General keeps the group chat id), not
  // a topic row; the panel is the channel panel, like the group panel.
  const isChannel = chat.chatKind === 'channel';
  const groupTitle = chat.groupTitle ?? storedGroupTitle;
  const openPanel = onOpenTopicPanel ?? onOpenAiPanel ?? onOpenGroupPanel ?? onOpenContactPanel;
  const panelLabel = isTopic
    ? `Open ${chat.title} topic info`
    : chat.isAI
      ? `Open ${chat.title} settings`
      : isChannel
        ? `Open ${chat.title} channel info`
        : `Open ${chat.title} info`;
  const [menuOpen, setMenuOpen] = useState(false);
  const [backgroundOpen, setBackgroundOpen] = useState(false);
  const [confirmingArchive, setConfirmingArchive] = useState(false);

  // T-1249: one info entry, shown in both menus (topics and everything else)
  // whenever this header can open the group/channel panel.
  const groupInfoItem =
    onOpenGroupPanel === undefined ? null : (
      <MenuItem
        icon={Users}
        onSelect={() => {
          setMenuOpen(false);
          onOpenGroupPanel();
        }}
      >
        {isChannel ? 'Channel info' : 'Group info'}
      </MenuItem>
    );
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
          <Globe role="img" aria-label="Public" className="size-3.5 text-muted-foreground" />
        )}
        {isTopic && chat.topic?.visibility === 'private' && (
          <Lock role="img" aria-label="Private" className="size-3.5 text-muted-foreground" />
        )}
      </div>
      <div
        role="status"
        className="flex items-center gap-1 text-[12px] leading-4 text-muted-foreground"
      >
        <span className="truncate">{subtitle}</span>
        {(working || typing !== undefined || aiLine !== undefined) && !writing && <TypingDots />}
      </div>
    </>
  );

  // On narrow screens the in-chat search bar replaces the header entirely
  // (WUX-34); ChatView owns that state so the contact panel can start the same
  // search, and this header only triggers it.
  return (
    <header className="relative flex h-16 shrink-0 items-center gap-2.5 border-b border-divider bg-panel/85 px-4">
      <IconButton aria-label="Back to chats" onClick={() => navigate('/')} className="wide:hidden">
        <ArrowLeft className="size-5" aria-hidden="true" />
      </IconButton>
      <EntityAvatar chat={chat} size={36} online={chat.online === true} ai={chat.isAI} />
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
      {isTopic && <AisHereKey chat={chat} />}
      <IconButton aria-label="Search in chat" onClick={onSearch}>
        <Search className="size-5" aria-hidden="true" />
      </IconButton>
      <div className="relative">
        <Menu
          open={menuOpen}
          onOpenChange={setMenuOpen}
          label={isTopic ? 'Topic actions' : `Actions for ${chat.title}`}
          align="end"
          trigger={
            <IconButton aria-label="Chat menu">
              <MoreVertical className="size-5" aria-hidden="true" />
            </IconButton>
          }
        >
          {isTopic ? (
            <>
              {groupInfoItem}
              <MenuItem
                icon={Info}
                onSelect={() => {
                  setMenuOpen(false);
                  openPanel?.();
                }}
              >
                Topic info
              </MenuItem>
              <MenuItem
                icon={Bookmark}
                onSelect={() => {
                  setMenuOpen(false);
                  storeApi.getState().setPinsPanel(chat.id);
                }}
              >
                Pinned messages
              </MenuItem>
              <MenuItem
                icon={Images}
                onSelect={() => {
                  setMenuOpen(false);
                  onOpenMedia?.();
                }}
              >
                Media, files and links
              </MenuItem>
              <MenuItem
                icon={Search}
                onSelect={() => {
                  setMenuOpen(false);
                  onSearch();
                }}
              >
                Search
              </MenuItem>
              <MenuItem
                icon={Palette}
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
                    setConfirmingArchive(true);
                  }}
                />
              </ChatPrefMenuItems>
            </>
          ) : (
            <>
              {groupInfoItem}
              <MenuItem
                icon={Bookmark}
                onSelect={() => {
                  setMenuOpen(false);
                  storeApi.getState().setPinsPanel(chat.id);
                }}
              >
                Pinned messages
              </MenuItem>
              <MenuItem
                icon={Images}
                onSelect={() => {
                  setMenuOpen(false);
                  onOpenMedia?.();
                }}
              >
                Media, files and links
              </MenuItem>
              <MenuItem
                icon={Palette}
                onSelect={() => {
                  setMenuOpen(false);
                  setBackgroundOpen(true);
                }}
              >
                Chat background
              </MenuItem>
              <ChatPrefMenuItems chat={chat} onDone={(failed) => !failed && setMenuOpen(false)} />
            </>
          )}
        </Menu>
      </div>
      <ChatBackgroundDialog
        chat={chat}
        open={backgroundOpen}
        onClose={() => setBackgroundOpen(false)}
      />
      {confirmingArchive && (
        <ConfirmDialog
          title={`Archive “${chat.title}” for everyone?`}
          body="The topic disappears from the list for everyone. Its history stays on the server."
          confirmLabel="Archive"
          onConfirm={() => {
            setConfirmingArchive(false);
            runArchive();
          }}
          onCancel={() => setConfirmingArchive(false)}
        />
      )}
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
