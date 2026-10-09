import { Effect } from 'effect';
import { AsyncResult } from 'effect/reactivity';
import { FileText, Image as ImageIcon, Link2, Mic, X } from 'lucide-react';
import { useState } from 'react';
import { Button } from './ui/button';
import { SegmentedControl } from './ui/segmented-control';
import { Sheet } from './ui/sheet';
import { StateMessage } from './ui/state-message';
import type { MediaItem, MediaPage, MediaTab } from '@/lib/api';
import { formatFileSize, mediaSrc, safeHttpUrl } from '@/lib/attachments';
import { fromApi } from '@/lib/effect/api-effect';
import { failureOf, isWaiting, useAction } from '@/lib/effect/use-action';
import { useQuery } from '@/lib/effect/use-query';
import { scrollToMessage } from '@/lib/scrollToMessage';
import { useChatStore, useChatStoreApi } from '@/store/ChatStoreProvider';

const TABS: { value: MediaTab; label: string }[] = [
  { value: 'media', label: 'Media' },
  { value: 'files', label: 'Files' },
  { value: 'links', label: 'Links' },
  { value: 'voice', label: 'Voice' },
];

const EMPTY_TITLE: Record<MediaTab, string> = {
  media: 'No media yet',
  files: 'No files yet',
  links: 'No links yet',
  voice: 'No voice messages yet',
};

const DATE_FORMAT = new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric' });

function formatDate(at: string): string {
  const date = new Date(at);
  return Number.isNaN(date.getTime()) ? '' : DATE_FORMAT.format(date);
}

function formatDuration(ms: number | undefined): string {
  if (ms === undefined || !Number.isFinite(ms)) {
    return '';
  }
  const total = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

function byline(item: MediaItem): string {
  const parts = [formatDate(item.at)];
  if (item.senderName !== '') {
    parts.unshift(item.senderName);
  }
  return parts.filter((part) => part !== '').join(' · ');
}

function rowSubtitle(item: MediaItem): string {
  const lead =
    item.kind === 'file' && item.size !== undefined ? formatFileSize(item.size) : undefined;
  return [lead, byline(item)].filter((part) => part !== undefined && part !== '').join(' · ');
}

// One message can yield several items (two links in one body), so the key needs
// the kind/reference and the item's position, not just the message id.
function mediaItemKey(item: MediaItem, index: number): string {
  return `${item.messageId}-${item.kind}-${item.url ?? item.linkUrl ?? ''}-${index}`;
}

/** The chat a row opens items in, and the panel's reactions to a jump. */
interface JumpTarget {
  readonly chatId: string;
  readonly onStart: () => void;
  readonly onOpened: () => void;
  readonly onFailed: () => void;
}

// Opens an item at its message: the panel closes and the bubble is scrolled
// into view. Each row calls this with its own action, so two rows can jump
// at once while a second click on the same row waits for the first.
function useShowInChat(target: JumpTarget): (item: MediaItem) => void {
  const storeApi = useChatStoreApi();
  const [, open] = useAction((item: MediaItem) =>
    fromApi(() => storeApi.getState().openAtMessage(target.chatId, item.messageId)).pipe(
      Effect.tap(() =>
        Effect.sync(() => {
          target.onOpened();
          window.requestAnimationFrame(() => {
            scrollToMessage(item.messageId);
          });
        }),
      ),
      Effect.tapError(() => Effect.sync(target.onFailed)),
    ),
  );
  return (item) => {
    target.onStart();
    open(item);
  };
}

function ShowInChatButton({ item, jump }: { item: MediaItem; jump: JumpTarget }) {
  const showInChat = useShowInChat(jump);
  const label =
    item.name !== undefined && item.name !== ''
      ? item.name
      : item.kind === 'link'
        ? (item.linkHost ?? 'link')
        : 'this item';
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      aria-label={`Show ${label} in chat`}
      className="shrink-0"
      onClick={() => showInChat(item)}
    >
      Show in chat
    </Button>
  );
}

function FileRow({ item, jump }: { item: MediaItem; jump: JumpTarget }) {
  const icon =
    item.kind === 'image' || item.kind === 'gif' ? (
      <ImageIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
    ) : item.kind === 'voice' ? (
      <Mic className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
    ) : (
      <FileText className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
    );
  const title =
    item.name !== undefined && item.name !== ''
      ? item.name
      : item.kind === 'voice'
        ? formatDuration(item.durationMs) || 'Voice message'
        : 'File';
  return (
    <div className="flex items-center gap-2 rounded-xl px-2 py-1.5 hover:bg-list-hover">
      {icon}
      <div className="min-w-0 flex-1">
        <div className="truncate text-[14px] font-semibold">{title}</div>
        <div className="truncate text-[13px] text-muted-foreground">{rowSubtitle(item)}</div>
      </div>
      <ShowInChatButton item={item} jump={jump} />
    </div>
  );
}

function LinkRow({ item, jump }: { item: MediaItem; jump: JumpTarget }) {
  const href = item.linkUrl === undefined ? undefined : safeHttpUrl(item.linkUrl);
  return (
    <div className="flex items-center gap-2 rounded-xl px-2 py-1.5 hover:bg-list-hover">
      <Link2 className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
      <div className="min-w-0 flex-1">
        {href === undefined ? (
          <div className="truncate text-[14px] font-semibold">{item.linkHost ?? 'Link'}</div>
        ) : (
          <a
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            className="block truncate text-[14px] font-semibold text-accent hover:underline"
          >
            {item.linkHost ?? href}
          </a>
        )}
        <div className="truncate text-[13px] text-muted-foreground">
          {[item.linkUrl, byline(item)]
            .filter((part) => part !== undefined && part !== '')
            .join(' · ')}
        </div>
      </div>
      <ShowInChatButton item={item} jump={jump} />
    </div>
  );
}

function MediaThumb({ chatId, item, jump }: { chatId: string; item: MediaItem; jump: JumpTarget }) {
  const showInChat = useShowInChat(jump);
  if (item.url === undefined) {
    return null;
  }
  const label = item.name !== undefined && item.name !== '' ? item.name : 'media';
  return (
    <button
      type="button"
      onClick={() => showInChat(item)}
      aria-label={`Show ${label} in chat`}
      className="aspect-square overflow-hidden rounded-lg bg-surface-raised focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
    >
      <img
        src={mediaSrc(chatId, item.url)}
        alt={label}
        loading="lazy"
        className="size-full object-cover"
      />
    </button>
  );
}

/**
 * The pages of one tab of one chat. It is keyed by chat and tab, so a tab
 * switch remounts it and interrupts the load still running for the old tab.
 * The first page loads on mount; "Load more" appends the next page.
 */
function MediaBody({
  chatId,
  tab,
  jump,
  onRetry,
}: {
  chatId: string;
  tab: MediaTab;
  jump: JumpTarget;
  onRetry: () => void;
}) {
  const storeApi = useChatStoreApi();
  const [first, reloadFirst] = useQuery(
    () => fromApi(() => storeApi.getState().loadChatMedia(chatId, tab, undefined)),
    [storeApi, chatId, tab],
  );
  const [extra, setExtra] = useState<ReadonlyArray<MediaPage>>([]);
  const [more, loadMore, moreControls] = useAction((cursor: string) =>
    fromApi(() => storeApi.getState().loadChatMedia(chatId, tab, cursor)).pipe(
      Effect.tap((page) =>
        Effect.sync(() => {
          setExtra((pages) => [...pages, page]);
        }),
      ),
    ),
  );

  const page = AsyncResult.isSuccess(first) ? first.value : undefined;
  // A failure is hidden while a new call runs, as the page did before.
  const firstFailure = isWaiting(first) ? undefined : failureOf(first);
  const moreFailure = isWaiting(more) ? undefined : failureOf(more);
  const pages = page === undefined ? [] : [page, ...extra];
  const items = pages.flatMap((entry) => entry.items);
  const next = pages[pages.length - 1]?.next ?? null;
  const loadingMore = isWaiting(more);

  let status: 'loading' | 'ready' | 'error';
  if (isWaiting(first) || (page === undefined && firstFailure === undefined)) {
    status = 'loading';
  } else if (firstFailure !== undefined || moreFailure !== undefined) {
    status = 'error';
  } else {
    status = 'ready';
  }

  const retry = (): void => {
    moreControls.reset();
    setExtra([]);
    onRetry();
    reloadFirst();
  };

  const loadNext = (): void => {
    if (next === null) {
      return;
    }
    loadMore(next);
  };

  const withUrl = tab === 'media' ? items.filter((item) => item.url !== undefined) : [];
  const withoutUrl = tab === 'media' ? items.filter((item) => item.url === undefined) : [];

  return (
    <>
      {status === 'loading' && <StateMessage kind="loading" title="Loading…" />}
      {status === 'error' && (
        <StateMessage
          kind="error"
          title="Could not load media"
          hint="Check your connection and try again."
          action={{ label: 'Retry', onClick: retry }}
        />
      )}
      {status === 'ready' && items.length === 0 && (
        <StateMessage kind="empty" title={EMPTY_TITLE[tab]} />
      )}
      {status === 'ready' && items.length > 0 && (
        <>
          {tab === 'media' && (
            <div className="flex flex-col gap-2">
              {withUrl.length > 0 && (
                <div className="grid grid-cols-3 gap-1">
                  {withUrl.map((item, index) => (
                    <MediaThumb
                      key={mediaItemKey(item, index)}
                      chatId={chatId}
                      item={item}
                      jump={jump}
                    />
                  ))}
                </div>
              )}
              {withoutUrl.map((item, index) => (
                <FileRow key={mediaItemKey(item, index)} item={item} jump={jump} />
              ))}
            </div>
          )}
          {tab === 'files' &&
            items.map((item, index) => (
              <FileRow key={mediaItemKey(item, index)} item={item} jump={jump} />
            ))}
          {tab === 'links' &&
            items.map((item, index) => (
              <LinkRow key={mediaItemKey(item, index)} item={item} jump={jump} />
            ))}
          {tab === 'voice' &&
            items.map((item, index) => (
              <FileRow key={mediaItemKey(item, index)} item={item} jump={jump} />
            ))}
          {next !== null && (
            <Button
              type="button"
              variant="outline"
              className="mt-2 self-center"
              disabled={loadingMore}
              onClick={loadNext}
            >
              {loadingMore ? 'Loading…' : 'Load more'}
            </Button>
          )}
        </>
      )}
    </>
  );
}

/**
 * The chat media gallery (T-0434): Media / Files / Links / Voice tabs backed by
 * `GET /api/media`. Media items on an untrusted host arrive without a `url`
 * (see the real store), so they render as a file row and never auto-load.
 * Opened from the chat menu for DMs, groups and topics.
 */
export function ChatMediaPanel({ chatId, onClose }: { chatId: string; onClose: () => void }) {
  const store = useChatStore();
  const [tab, setTab] = useState<MediaTab>('media');
  const [jumpFailed, setJumpFailed] = useState(false);

  const jump: JumpTarget = {
    chatId,
    onStart: () => setJumpFailed(false),
    onOpened: onClose,
    onFailed: () => setJumpFailed(true),
  };

  const selectTab = (value: MediaTab): void => {
    if (value === tab) {
      return;
    }
    setJumpFailed(false);
    setTab(value);
  };

  const chat = store.chats.find((entry) => entry.id === chatId);
  const label = chat?.title ?? 'this chat';

  return (
    <Sheet open onClose={onClose} ariaLabel={`Media, files and links in ${label}`}>
      <header className="flex shrink-0 items-center gap-3 border-b border-divider p-4">
        <ImageIcon className="size-5 shrink-0 text-muted-foreground" aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <div className="truncate text-[16px] font-semibold">Media, files and links</div>
          <p className="text-[13px] text-muted-foreground">{chat?.title ?? 'This chat'}</p>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon-lg"
          aria-label="Close media, files and links"
          onClick={onClose}
          className="shrink-0 rounded-full text-muted-foreground"
        >
          <X className="size-5" aria-hidden="true" />
        </Button>
      </header>

      <div className="shrink-0 px-4 pt-3">
        <SegmentedControl
          options={TABS}
          value={tab}
          onChange={(value) => selectTab(value as MediaTab)}
          ariaLabel="Media tabs"
        />
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto p-4">
        <MediaBody
          key={`${chatId}|${tab}`}
          chatId={chatId}
          tab={tab}
          jump={jump}
          onRetry={() => setJumpFailed(false)}
        />
        {jumpFailed && (
          <p role="alert" className="px-2 text-[13px] text-danger">
            Message not found
          </p>
        )}
      </div>
    </Sheet>
  );
}
