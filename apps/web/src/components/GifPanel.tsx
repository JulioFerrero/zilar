import { Effect } from 'effect';
import { AsyncResult } from 'effect/reactivity';
import { useEffect, useMemo, useRef, useState } from 'react';
import { gifMediaUrl, searchGifs, trendingGifs, type GifPage, type GifResult } from '@/lib/api';
import { fromApi } from '@/lib/effect/api-effect';
import type { ApiFailure } from '@/lib/effect/errors';
import { failureOf, isWaiting, useAction } from '@/lib/effect/use-action';
import { useQuery } from '@/lib/effect/use-query';
import { useMediaQuery } from '@/lib/useMediaQuery';
import { cn } from '@/lib/utils';
import { SearchField } from '@/components/ui/search-field';
import { StateMessage } from '@/components/ui/state-message';

export interface GifChoice {
  /** The provider item id (for attribution keys, never fetched). */
  id: string;
  title: string;
  /** Same-origin proxy URL for the media bytes. */
  url: string;
  kind: 'image' | 'video';
  width: number;
  height: number;
  sizeBytes?: number | undefined;
}

export interface GifPanelProps {
  onPick: (gif: GifChoice) => void;
  /** Mock mode serves generated placeholders without a server. */
  mockItems?: GifResult[] | undefined;
}

/** The pages after the first one, for the search that is shown. */
interface MorePages {
  readonly items: GifResult[];
  readonly nextPos: string | undefined;
}

const SEARCH_DEBOUNCE_MS = 300;
const ATTRIBUTION = 'Powered by Giphy';
const LOAD_ERROR = 'Could not load GIFs. Try again.';
const NO_PAGE: GifPage = { items: [] };

/**
 * Probes GIF availability once per session and remembers the answer: `true`
 * while the provider answers, `false` after a 501 `gifs_unavailable`, and
 * `undefined` before the first probe. Network errors keep the answer unknown
 * (the tab stays, the panel shows Retry) so a transient outage does not
 * permanently hide the tab.
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

/** The cached answer, or one probe of the provider when none is cached yet. */
export function probeGifsAvailabilityEffect(): Effect.Effect<boolean> {
  return Effect.suspend(() => {
    const cached = gifsAvailabilityCache.value;
    return cached === undefined ? probeProvider() : Effect.succeed(cached);
  });
}

export function probeGifsAvailability(): Promise<boolean> {
  return Effect.runPromise(probeGifsAvailabilityEffect());
}

/** One page: the trending feed for an empty search, otherwise the search. */
function pageOf(search: string, pos: string | undefined): Effect.Effect<GifPage, ApiFailure> {
  const term = search.trim();
  return fromApi((signal) =>
    term === '' ? trendingGifs(pos, signal) : searchGifs(term, pos, signal),
  );
}

/** The failure of the last call, hidden while a new call runs (as BlockedPage does). */
function shownFailure<A>(state: AsyncResult.AsyncResult<A, ApiFailure>): ApiFailure | undefined {
  return isWaiting(state) ? undefined : failureOf(state);
}

/**
 * The bytes to show for one result. Real results load through the
 * same-origin proxy; mock placeholders are app-generated `data:image/` art
 * (the same trust argument as the sticker demo packs) and render directly.
 */
export function gifPreviewUrl(item: Pick<GifResult, 'mediaToken'>): string {
  return item.mediaToken.startsWith('data:image/') ? item.mediaToken : gifMediaUrl(item.mediaToken);
}

/**
 * One GIF cell: video loops muted inline (only while visible), images are
 * plain `<img>`. Every byte loads through the same-origin proxy, never the
 * provider. `prefers-reduced-motion` shows still frames: videos render
 * paused without autoplay.
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

/**
 * The GIFs tab (T-0122): debounced search (300 ms, cancelling), trending on
 * open, a 2-column grid of proxy-loaded previews, infinite scroll with `pos`,
 * and the provider attribution. Empty, error and unavailable states included.
 *
 * T-0146: when the server answers 501 `gifs_unavailable` (provider off), the
 * sticker panel hides this tab instead of showing a dead-end message. The
 * probe runs once per session (`gifsAvailability`) and caches the answer;
 * `GifPanel` still renders its own unavailable state when mounted directly.
 */
export function GifPanel({ onPick, mockItems }: GifPanelProps) {
  const isMock = mockItems !== undefined;
  const [typed, setTyped] = useState('');
  // The search the results show: it moves 300 ms after the last keystroke.
  const [searched, setSearched] = useState('');
  // Mock placeholders are read once at mount and never reloaded.
  const [mockList] = useState<GifResult[]>(() => mockItems ?? []);
  const [more, setMore] = useState<MorePages | undefined>(undefined);
  const [visibleIds, setVisibleIds] = useState<ReadonlySet<string>>(
    () =>
      new Set(
        typeof IntersectionObserver === 'undefined'
          ? (mockItems ?? []).map((item) => item.mediaToken)
          : [],
      ),
  );
  const cellRefs = useRef(new Map<string, HTMLDivElement | null>());

  // The next page of the shown search. A new search cancels it (below).
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

  // The debounce: each keystroke restarts the 300 ms wait. When it ends, the
  // shown search changes and any page still loading for the old one is
  // cancelled, so the grid keeps the old results until then. A wait whose
  // keystroke is no longer the latest does nothing, even if it was not
  // cancelled in time.
  const latestTyped = useRef('');
  useQuery(
    () =>
      Effect.sleep(SEARCH_DEBOUNCE_MS).pipe(
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

  const [firstState, reloadFirst] = useQuery(
    () => (isMock ? Effect.succeed(NO_PAGE) : pageOf(searched, undefined)),
    [searched, isMock],
  );
  const page = AsyncResult.isSuccess(firstState) ? firstState.value : undefined;
  const firstSettled = AsyncResult.isNotInitial(firstState) && !isWaiting(firstState);
  const loading = !isMock && !firstSettled;
  const loadingMore = isWaiting(moreState);
  const failure = shownFailure(firstState) ?? shownFailure(moreState);
  const unavailable = failure?.code === 'gifs_unavailable';
  const error = failure !== undefined && !unavailable ? LOAD_ERROR : undefined;

  const items = useMemo(
    () => (isMock ? mockList : [...(page?.items ?? []), ...(more?.items ?? [])]),
    [isMock, mockList, page, more],
  );
  const nextPos = more !== undefined ? more.nextPos : page?.nextPos;

  // Only visible items play: an IntersectionObserver tracks the cells. When
  // the observer is unavailable every item counts as visible (also the
  // initial state above).
  useEffect(() => {
    if (typeof IntersectionObserver === 'undefined') {
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
  }, [items]);

  const loadMore = (): void => {
    if (nextPos !== undefined && !loadingMore && !loading) {
      loadMorePage(nextPos);
    }
  };

  // Retry starts again from the first page; pages loaded before are dropped.
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
                <GifCell item={item} onPick={onPick} visible={visibleIds.has(item.mediaToken)} />
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
