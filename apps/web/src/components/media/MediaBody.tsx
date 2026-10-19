import { fromApi, failureOf, isWaiting } from '@zilar/client-core';
import { Effect } from 'effect';
import { AsyncResult } from 'effect/reactivity';
import { FileText, Image as ImageIcon, Link2, Mic } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { StateMessage } from '@/components/ui/state-message';
import type { MediaItem, MediaPage, MediaTab } from '@/lib/api';
import { mediaSrc } from '@/lib/attachments';
import { useAction } from '@/lib/effect/use-action';
import { useQuery } from '@/lib/effect/use-query';
import { scrollToMessage } from '@/lib/scrollToMessage';
import { useChatStoreApi } from '@/store/ChatStoreProvider';
import {
  EMPTY_TITLE,
  byline,
  formatDuration,
  mediaItemKey,
  rowSubtitle,
  type JumpTarget,
} from './mediaModel';
import { safeHttpUrl } from '@zilar/chat-core';

export function MediaBody({
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
