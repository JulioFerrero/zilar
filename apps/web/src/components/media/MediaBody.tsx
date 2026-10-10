import { Effect } from 'effect';
import { AsyncResult } from 'effect/reactivity';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { StateMessage } from '@/components/ui/state-message';
import type { MediaPage, MediaTab } from '@/lib/api';
import { fromApi } from '@/lib/effect/api-effect';
import { failureOf, isWaiting, useAction } from '@/lib/effect/use-action';
import { useQuery } from '@/lib/effect/use-query';
import { useChatStoreApi } from '@/store/ChatStoreProvider';
import { EMPTY_TITLE, mediaItemKey, type JumpTarget } from './mediaModel';
import { FileRow, LinkRow, MediaThumb } from './MediaRows';

/**
 * The pages of one tab of one chat. It is keyed by chat and tab, so a tab
 * switch remounts it and interrupts the load still running for the old tab.
 * The first page loads on mount; "Load more" appends the next page.
 */
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
