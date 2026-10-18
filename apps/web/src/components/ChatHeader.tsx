import { chatSubtitle, typingLabel, type ChatSummary } from '@zilar/chat-core';
import {
  ArrowLeft,
  Bookmark,
  Images,
  Info,
  MoreVertical,
  Palette,
  Search,
  Users,
  Globe,
  Lock,
} from 'lucide-react';
import { Data, Effect } from 'effect';
import { useState } from 'react';
import { useNavigate } from 'react-router';
import { EntityAvatar } from './EntityAvatar';
import { ChatBackgroundDialog } from './ChatBackgroundDialog';
import { ChatPrefMenuItems } from './ChatActionsMenu';
import { ConfirmDialog } from './ConfirmDialog';
import { AisHereKey } from './topic/AisHereKey';
import { IconButton } from './ui/icon-button';
import { Menu, MenuItem } from './ui/menu';
import { statusLabel } from '@/components/chatList/rowsSelector';
import { failureOf, isWaiting, useAction } from '@/lib/effect/use-action';
import { useChatSelector, useChatStoreApi } from '@/store/ChatStoreProvider';
import { AiBadge } from './AiBadge';
import { TopicPeopleLine } from './topic/TopicPeopleLine';
import { cn } from '@/lib/utils';

function TypingDots({ className }: { className?: string }) {
  return (
    <span className={cn('inline-flex items-center gap-0.5', className)} aria-hidden="true">
      {[0, 1, 2].map((index) => (
        <span
          key={index}
          className="typing-dot size-1 rounded-full bg-current"
          style={{ animationDelay: `${index * 0.2}s` }}
        />
      ))}
    </span>
  );
}

function ChatHeaderTitle({ chat, isTopic }: { chat: ChatSummary; isTopic: boolean }) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="truncate text-[15px] leading-5 font-semibold">{chat.title}</span>
      {chat.isAI && <AiBadge />}
      {chat.visibility === 'public' && (
        <Globe role="img" aria-label="Public" className="size-3.5 text-muted-foreground" />
      )}
      {isTopic && chat.topic?.visibility === 'private' && (
        <Lock role="img" aria-label="Private" className="size-3.5 text-muted-foreground" />
      )}
    </div>
  );
}

function ChatHeaderSubtitle({
  chat,
  isTopic,
  names,
  groupTitle,
  onOpen,
  connection,
  aiLine,
  subtitle,
  showTypingDots,
}: {
  chat: ChatSummary;
  isTopic: boolean;
  names: readonly string[];
  groupTitle: string | undefined;
  onOpen: (() => void) | undefined;
  connection: string | undefined;
  aiLine: string | undefined;
  subtitle: string;
  showTypingDots: boolean;
}) {
  if (isTopic && connection === undefined && aiLine === undefined) {
    return <TopicPeopleLine chat={chat} groupTitle={groupTitle} names={names} onOpen={onOpen} />;
  }
  return (
    <div
      role="status"
      className="flex items-center gap-1 text-[12px] leading-4 text-muted-foreground"
    >
      <span className="truncate">{subtitle}</span>
      {showTypingDots && <TypingDots />}
    </div>
  );
}

const ARCHIVE_ERROR = 'Could not archive the topic.';
const NO_NAMES: string[] = [];

/**
 * The web store's `TypingState` types only `names`, so the status is read
 * through a widened record.
 */
type TypingStatus = { status?: string };

/** The topic could not be archived (the store rejected the patch). */
class ArchiveFailed extends Data.TaggedError('ArchiveFailed') {}

/** The two menu items both chat menus share, in this order. */
function PinsAndMediaItems(props: {
  chatId: string;
  onOpenMedia: (() => void) | undefined;
  close: () => void;
}) {
  const storeApi = useChatStoreApi();
  const run = (action: () => void) => () => {
    props.close();
    action();
  };
  return (
    <>
      <MenuItem
        icon={Bookmark}
        onSelect={run(() => storeApi.getState().setPinsPanel(props.chatId))}
      >
        Pinned messages
      </MenuItem>
      <MenuItem icon={Images} onSelect={run(() => props.onOpenMedia?.())}>
        Media, files and links
      </MenuItem>
    </>
  );
}

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
  const connection = statusLabel(useChatSelector((s) => s.status));
  const aiStatusText = useChatSelector(
    (s) => (s.typing[chat.id] as TypingStatus | undefined)?.status,
  );
  const hasDraft = useChatSelector((s) => s.drafts[chat.id] !== undefined);
  const storedGroupTitle = useChatSelector((s) => s.groupInfo(chat.id)?.title);
  const typing = typingLabel(chat, names);
  const writing = chat.isAI && hasDraft;
  const working = chat.isAI && chat.aiStatus === 'working';
  const aiLine = aiStatusText === undefined ? undefined : `${aiStatusText}…`;
  const subtitle =
    connection ?? aiLine ?? (writing ? 'writing…' : (typing ?? chatSubtitle(chat, new Date())));
  const isTopic = chat.topic !== undefined;
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
  const closeMenu = () => setMenuOpen(false);

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

  const line1 = <ChatHeaderTitle chat={chat} isTopic={isTopic} />;
  const line2 = (
    <ChatHeaderSubtitle
      chat={chat}
      isTopic={isTopic}
      names={names}
      groupTitle={groupTitle}
      onOpen={openPanel}
      connection={connection}
      aiLine={aiLine}
      subtitle={subtitle}
      showTypingDots={(working || typing !== undefined || aiLine !== undefined) && !writing}
    />
  );

  return (
    <header className="relative flex h-16 shrink-0 items-center gap-2.5 border-b border-divider bg-panel/85 px-4">
      <IconButton aria-label="Back to chats" onClick={() => navigate('/')} className="wide:hidden">
        <ArrowLeft className="size-5" aria-hidden="true" />
      </IconButton>
      {openPanel === undefined ? (
        <EntityAvatar chat={chat} size={36} online={chat.online === true} ai={chat.isAI} />
      ) : (
        <button
          type="button"
          onClick={openPanel}
          tabIndex={-1}
          aria-hidden="true"
          className="shrink-0 rounded-full"
        >
          <EntityAvatar chat={chat} size={36} online={chat.online === true} ai={chat.isAI} />
        </button>
      )}
      {openPanel !== undefined ? (
        isTopic ? (
          <div className="flex min-w-0 flex-1 flex-col gap-[3px]">
            <button
              type="button"
              aria-label={panelLabel}
              onClick={openPanel}
              className="min-w-0 rounded-lg text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
            >
              {line1}
            </button>
            {line2}
          </div>
        ) : (
          <button
            type="button"
            aria-label={panelLabel}
            onClick={openPanel}
            className="min-w-0 flex-1 rounded-lg text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
          >
            {line1}
            {line2}
          </button>
        )
      ) : (
        <div className="min-w-0 flex-1">
          {line1}
          {line2}
        </div>
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
          {groupInfoItem}
          {isTopic && (
            <MenuItem
              icon={Info}
              onSelect={() => {
                closeMenu();
                openPanel?.();
              }}
            >
              Topic info
            </MenuItem>
          )}
          <PinsAndMediaItems chatId={chat.id} onOpenMedia={onOpenMedia} close={closeMenu} />
          {isTopic && (
            <MenuItem
              icon={Search}
              onSelect={() => {
                closeMenu();
                onSearch();
              }}
            >
              Search
            </MenuItem>
          )}
          <MenuItem
            icon={Palette}
            onSelect={() => {
              closeMenu();
              setBackgroundOpen(true);
            }}
          >
            Chat background
          </MenuItem>
          <ChatPrefMenuItems chat={chat} onDone={(failed) => !failed && closeMenu()}>
            {isTopic && (
              <TopicArchiveItem
                chat={chat}
                archiving={archiving}
                onArchive={() => {
                  closeMenu();
                  setConfirmingArchive(true);
                }}
              />
            )}
          </ChatPrefMenuItems>
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
  // Needs a manager and hides until the role is known; never for General.
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
