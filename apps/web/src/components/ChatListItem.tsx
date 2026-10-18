import {
  formatListTime,
  lightToPlain,
  markdownToPlain,
  previewBody,
  previewKind,
  previewPrefix,
  shouldRenderMarkdown,
  type ChatSummary,
  type PreviewKind,
  type UiMessage,
} from '@zilar/chat-core';
import {
  File,
  Image as ImageIcon,
  Images,
  Megaphone,
  Mic,
  Paperclip,
  Pin,
  VolumeX,
  type LucideIcon,
} from 'lucide-react';
import { memo, useState } from 'react';
import { Link } from 'react-router';
import { AiBadge } from './AiBadge';
import { EntityAvatar } from './EntityAvatar';
import { RowActions } from './chatList/RowActions';
import { MessageTicks } from './MessageTicks';
import { Badge } from './ui/badge';
import { useChatSelector } from '@/store/ChatStoreProvider';
import { useBlockedJids } from '@/lib/blockedJids';
import { useComposerDraft } from '@/lib/composer-drafts';
import { typingLabel } from '@/lib/format';
import { previewMessage } from '@/lib/preview-message';
import { cn } from '@/lib/utils';

const EMPTY_MESSAGES: UiMessage[] = [];
const EMPTY_NAMES: string[] = [];

/** The lucide icon for each `previewKind`, in the kind's own order. */
const PREVIEW_ICONS: Record<PreviewKind, LucideIcon> = {
  photo: ImageIcon,
  album: Images,
  voice: Mic,
  file: Paperclip,
  card: File,
};

export const ChatListItem = memo(function ChatListItem({
  chat,
  selected,
  isWide = true,
}: {
  chat: ChatSummary;
  selected: boolean;
  isWide?: boolean;
}) {
  const chatId = chat.id;
  const messages = useChatSelector((s) => s.messagesByChat[chatId]) ?? EMPTY_MESSAGES;
  const currentUserId = useChatSelector((s) => s.currentUserId);
  const typingNames = useChatSelector((s) => s.typing[chatId]?.names) ?? EMPTY_NAMES;
  const hasDraft = useChatSelector((s) => s.drafts[chatId] !== undefined);
  // T-1170 (WUX-3): a chat that is not open shows its composer draft instead of
  // the last message, as Telegram does. `hasDraft` above is the AI reply draft.
  const composerDraft = useComposerDraft(chatId);
  const draftLine = composerDraft.trimStart().split('\n')[0] ?? '';
  const showDraft = !selected && composerDraft.trim().length > 0;
  const last = chat.lastMessage;
  const blockedJids = useBlockedJids();
  const preview = previewMessage(chat, messages, blockedJids, currentUserId);
  const options = { isGroup: chat.kind === 'group', currentUserId };
  const prefix = previewPrefix(preview, options);
  const rawBody = previewBody(preview);
  const kind = previewKind(preview);
  const KindIcon = kind === undefined ? undefined : PREVIEW_ICONS[kind];
  // Only an incoming AI reply is Markdown (shouldRenderMarkdown), in an AI
  // chat or in a group; your own message previews literally, exactly as its
  // bubble shows it.
  const body =
    preview !== undefined && shouldRenderMarkdown(chat, preview, currentUserId)
      ? markdownToPlain(rawBody)
      : lightToPlain(rawBody);
  const own = last !== undefined && last.senderId === currentUserId;
  const typing = typingLabel(chat, typingNames);
  // `writing…` is the AI's reveal; people keep D23's wording (with the new dot).
  const writing = chat.isAI && (hasDraft || typing !== undefined);
  const typingText = typing === undefined ? undefined : `${typing}…`;
  const [menuOpen, setMenuOpen] = useState(false);
  // T-0124: channels get a megaphone avatar badge and a Channel label (as in
  // the mockup); the header shows "N subscribers".
  // T-0164: public groups and channels get a Public label next to the title.
  // WUX-43: both are sentence-case muted text, not role-chip-style tags.
  const isChannel = chat.chatKind === 'channel';
  const isPublic = chat.visibility === 'public';

  return (
    <div className="group relative">
      <Link
        to={`/c/${encodeURIComponent(chat.id)}`}
        data-topic-row=""
        aria-current={selected ? 'page' : undefined}
        onContextMenu={(event) => {
          event.preventDefault();
          setMenuOpen(true);
        }}
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
        <EntityAvatar
          chat={chat}
          size={isWide ? 44 : 52}
          online={chat.online === true}
          ai={chat.isAI}
        />
        <div className={cn('min-w-0 flex-1', !isWide && 'border-b border-border pb-2.5')}>
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
              <span className="shrink-0 text-[12px] leading-5 text-muted-foreground">Channel</span>
            )}
            {isPublic && (
              <span className="shrink-0 text-[12px] leading-5 text-muted-foreground">Public</span>
            )}
            <span className="ml-auto flex shrink-0 items-center gap-2 pl-1.5">
              {chat.muted && (
                <VolumeX aria-label="Muted" className="size-4 text-subtle-foreground" />
              )}
              {last !== undefined && (
                <span className="font-mono text-[11px] text-subtle-foreground transition-opacity group-hover:opacity-0 group-focus-within:opacity-0">
                  {formatListTime(last.createdAt, new Date())}
                </span>
              )}
            </span>
          </div>
          <div className="relative mt-0.5 flex items-center gap-1.5">
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
            ) : showDraft ? (
              <span className="truncate text-[13px] leading-5 text-muted-foreground">
                <span className="text-danger">Draft:</span> {draftLine}
              </span>
            ) : (
              <span className="flex min-w-0 items-center gap-1.5 text-[13px] leading-5 text-muted-foreground">
                {KindIcon !== undefined && (
                  <KindIcon className="size-3.5 shrink-0" aria-hidden="true" />
                )}
                <span className="truncate">
                  {prefix.length > 0 && <span className="text-foreground">{prefix}</span>}
                  {body}
                </span>
              </span>
            )}
            {chat.unread > 0 ? (
              <Badge
                count={chat.unread}
                muted={chat.muted}
                labelSuffix="unread"
                className="ml-auto shrink-0"
              />
            ) : chat.unreadMark === true ? (
              // T-1244: a hand-set unread mark shows a plain dot (no count).
              <span
                role="img"
                aria-label="Marked unread"
                className={cn(
                  'ml-auto size-2.5 shrink-0 rounded-full',
                  chat.muted ? 'bg-badge-muted' : 'key-primary',
                )}
              />
            ) : (
              own &&
              last !== undefined && (
                <span className="ml-auto flex shrink-0 items-center text-subtle-foreground">
                  <MessageTicks status={last.status} />
                </span>
              )
            )}
          </div>
        </div>
      </Link>
      <RowActions chat={chat} isWide={isWide} menuOpen={menuOpen} setMenuOpen={setMenuOpen} />
    </div>
  );
});
