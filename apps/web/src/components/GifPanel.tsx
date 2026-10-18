import { Effect } from 'effect';
import { AsyncResult } from 'effect/reactivity';
import { useEffect, useMemo, useRef, useState } from 'react';
import { GIF_SEARCH_DEBOUNCE_MS } from '@zilar/chat-core';
import { gifMediaUrl, searchGifs, trendingGifs, type GifPage, type GifResult } from '@/lib/api';
import { fromApi } from '@/lib/effect/api-effect';
import type { ApiFailure } from '@/lib/effect/errors';
import { isWaiting, shownFailure, useAction } from '@/lib/effect/use-action';
import { useQuery } from '@/lib/effect/use-query';
import { useMediaQuery } from '@/lib/useMediaQuery';
import { cn } from '@/lib/utils';
import { SearchField } from '@/components/ui/search-field';
import { StateMessage } from '@/components/ui/state-message';

export interface GifChoice {
  /** Attribution only; the id is never fetched from the provider. */
  id: string;
  title: string;
  /** Same-origin proxy, never the provider. */
  url: string;
  kind: 'image' | 'video';
  width: number;
  height: number;
  sizeBytes?: number | undefined;
}

export interface GifPanelProps {
  onPick: (gif: GifChoice) => void;
}

interface MorePages {
  readonly items: GifResult[];
  readonly nextPos: string | undefined;
}

const ATTRIBUTION = 'Powered by Giphy';
const LOAD_ERROR = 'Could not load GIFs. Try again.';

/**
 * Probes availability once per session: `false` only on a 501, while network
 * errors stay `undefined` so a transient outage does not hide the tab.
 */
const gifsAvailabilityCache: { value: boolean | undefined } = { value: undefined };

export function gifsAvailability(): boolean | undefined {
  return gifsAvailabilityCache.value;
}

export function resetGifsAvailability(): void {
  gifsAvailabilityCache.value = undefined;
}

const probeProvider = (): Effect.Effect<boolean> =>
  fromApi(() => trendingGifs(undefined, undefined)).pipe(
    Effect.map(() => {
      gifsAvailabilityCache.value = true;
      return true;
    }),
    Effect.catchTag('ApiFailure', (failure) => {
      if (failure.code === 'gifs_unavailable') {
        gifsAvailabilityCache.value = false;
        return Effect.succeed(false);
      }
      return Effect.succeed(true);
    }),
  );

export function probeGifsAvailabilityEffect(): Effect.Effect<boolean> {
  return Effect.suspend(() => {
    const cached = gifsAvailabilityCache.value;
    return cached === undefined ? probeProvider() : Effect.succeed(cached);
  });
}

export function probeGifsAvailability(): Promise<boolean> {
  return Effect.runPromise(probeGifsAvailabilityEffect());
}

function pageOf(search: string, pos: string | undefined): Effect.Effect<GifPage, ApiFailure> {
  const term = search.trim();
  return fromApi((signal) =>
    term === '' ? trendingGifs(pos, signal) : searchGifs(term, pos, signal),
  );
}

/**
 * Bytes load through the same-origin proxy; mock `data:image/` placeholders
 * render directly.
 */
export function gifPreviewUrl(item: Pick<GifResult, 'mediaToken'>): string {
  return item.mediaToken.startsWith('data:image/') ? item.mediaToken : gifMediaUrl(item.mediaToken);
}

/**
 * One cell: video loops muted inline only while visible, images are plain
 * `<img>`, and reduced motion shows still frames.
 */
function GifCell({
  item,
  onPick,
  visible,
}: {
  item: GifResult;
  onPick: (gif: GifChoice) => void;
  visible: boolean;
}) {
  const reduceMotion = useMediaQuery('(prefers-reduced-motion: reduce)');
  const videoRef = useRef<HTMLVideoElement>(null);
  const url = gifPreviewUrl(item);

  useEffect(() => {
    const video = videoRef.current;
    if (video === null) {
      return;
    }
    if (visible && !reduceMotion) {
      // A refused play (autoplay policy) keeps the still frame.
      Effect.runFork(Effect.tryPromise(() => video.play()).pipe(Effect.ignore));
    } else {
      video.pause();
    }
  }, [visible, reduceMotion]);

  const choice: GifChoice = {
    id: item.id,
    title: item.title,
    url,
    kind: item.kind,
    width: item.width,
    height: item.height,
    ...(item.sizeBytes === undefined ? {} : { sizeBytes: item.sizeBytes }),
  };

  const label = item.title === '' ? 'GIF' : item.title;
  return (
    <button
      type="button"
      aria-label={`Send ${label}`}
      title={label}
      onClick={() => onPick(choice)}
      className="overflow-hidden rounded-[8px] bg-surface-raised focus-visible:outline-2 focus-visible:outline-offset-1"
    >
      {item.kind === 'video' ? (
        <video
          ref={videoRef}
          src={url}
          muted
          loop
          playsInline
          preload="metadata"
          aria-label={label}
          className="aspect-[4/3] w-full object-cover"
        />
      ) : (
        <img src={url} alt={label} loading="lazy" className="aspect-[4/3] w-full object-cover" />
      )}
    </button>
  );
}

export function GifPanel({ onPick }: GifPanelProps) {
  const [typed, setTyped] = useState('');
  const [searched, setSearched] = useState('');
  const [more, setMore] = useState<MorePages | undefined>(undefined);
  const [visibleIds, setVisibleIds] = useState<ReadonlySet<string>>(() => new Set());
  const cellRefs = useRef(new Map<string, HTMLDivElement | null>());

  const [moreState, loadMorePage, moreControls] = useAction((pos: string) =>
    pageOf(searched, pos).pipe(
      Effect.tap((page) =>
        Effect.sync(() =>
          setMore((previous) => ({
            items: [...(previous?.items ?? []), ...page.items],
            nextPos: page.nextPos,
          })),
        ),
      ),
    ),
  );

  // Each keystroke restarts the 300 ms wait; a stale wait does nothing.
  const latestTyped = useRef('');
  useQuery(
    () =>
      Effect.sleep(GIF_SEARCH_DEBOUNCE_MS).pipe(
        Effect.andThen(
          Effect.sync(() => {
            if (latestTyped.current !== typed) {
              return;
            }
            setSearched(typed);
            setMore(undefined);
            moreControls.reset();
          }),
        ),
      ),
    [typed],
  );

  const [firstState, reloadFirst] = useQuery(() => pageOf(searched, undefined), [searched]);
  const page = AsyncResult.isSuccess(firstState) ? firstState.value : undefined;
  const firstSettled = AsyncResult.isNotInitial(firstState) && !isWaiting(firstState);
  const loading = !firstSettled;
  const loadingMore = isWaiting(moreState);
  const failure = shownFailure(firstState) ?? shownFailure(moreState);
  const unavailable = failure?.code === 'gifs_unavailable';
  const error = failure !== undefined && !unavailable ? LOAD_ERROR : undefined;

  const items = useMemo(() => [...(page?.items ?? []), ...(more?.items ?? [])], [page, more]);
  const nextPos = more !== undefined ? more.nextPos : page?.nextPos;

  // Only visible cells play; without IntersectionObserver all count as visible.
  const observerUnavailable = typeof IntersectionObserver === 'undefined';
  useEffect(() => {
    if (observerUnavailable) {
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        setVisibleIds((previous) => {
          const next = new Set(previous);
          for (const entry of entries) {
            const token = entry.target.getAttribute('data-media-token');
            if (token === null) {
              continue;
            }
            if (entry.isIntersecting) {
              next.add(token);
            } else {
              next.delete(token);
            }
          }
          return next;
        });
      },
      { rootMargin: '100px' },
    );
    for (const cell of cellRefs.current.values()) {
      if (cell !== null) {
        observer.observe(cell);
      }
    }
    return () => observer.disconnect();
  }, [items, observerUnavailable]);

  const loadMore = (): void => {
    if (nextPos !== undefined && !loadingMore && !loading) {
      loadMorePage(nextPos);
    }
  };

  const retry = (): void => {
    setMore(undefined);
    moreControls.reset();
    reloadFirst();
  };

  if (unavailable) {
    return (
      <div className="flex h-[220px] flex-col items-center justify-center gap-1 px-4 text-center">
        <p className="text-[13px] text-muted-foreground">GIFs are not available on this server.</p>
        <p className="text-[12px] text-muted-foreground">{ATTRIBUTION}</p>
      </div>
    );
  }

  return (
    <div className="flex max-h-[300px] flex-col">
      <div className="p-2">
        <SearchField
          value={typed}
          onChange={(event) => {
            latestTyped.current = event.target.value;
            setTyped(event.target.value);
          }}
          placeholder="Search GIFs"
          aria-label="Search GIFs"
        />
      </div>
      {loading ? (
        <div className="flex h-[180px] items-center justify-center">
          <StateMessage kind="loading" title="Loading GIFs…" />
        </div>
      ) : error !== undefined ? (
        <div className="flex h-[180px] items-center justify-center">
          <StateMessage kind="error" title={error} action={{ label: 'Retry', onClick: retry }} />
        </div>
      ) : items.length === 0 ? (
        <div className="flex h-[180px] flex-col items-center justify-center gap-1 px-4 text-center">
          <p className="text-[13px] text-muted-foreground">
            {typed.trim() === ''
              ? 'No trending GIFs right now.'
              : 'No GIFs found. Try another search.'}
          </p>
          <p className="text-[12px] text-muted-foreground">{ATTRIBUTION}</p>
        </div>
      ) : (
        <>
          <div
            role="grid"
            aria-label="GIFs"
            onScroll={(event) => {
              const target = event.currentTarget;
              if (target.scrollHeight - target.scrollTop - target.clientHeight < 300) {
                loadMore();
              }
            }}
            className="grid min-h-0 flex-1 grid-cols-2 gap-1 overflow-y-auto p-2"
          >
            {items.map((item) => (
              <div
                key={item.mediaToken}
                ref={(cell) => {
                  if (cell === null) {
                    cellRefs.current.delete(item.mediaToken);
                  } else {
                    cellRefs.current.set(item.mediaToken, cell);
                  }
                }}
                data-media-token={item.mediaToken}
              >
                <GifCell
                  item={item}
                  onPick={onPick}
                  visible={observerUnavailable || visibleIds.has(item.mediaToken)}
                />
              </div>
            ))}
          </div>
          <div
            className={cn(
              'flex items-center justify-center gap-2 border-t border-edge px-2 py-1 text-[11px] text-muted-foreground',
            )}
          >
            <span>{ATTRIBUTION}</span>
            {loadingMore && <span>Loading more…</span>}
          </div>
        </>
      )}
    </div>
  );
}
