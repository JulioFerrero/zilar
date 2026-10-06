import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError, gifMediaUrl, searchGifs, trendingGifs, type GifResult } from '@/lib/api';
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

const SEARCH_DEBOUNCE_MS = 300;
const ATTRIBUTION = 'Powered by Giphy';

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

export async function probeGifsAvailability(): Promise<boolean> {
  if (gifsAvailabilityCache.value !== undefined) {
    return gifsAvailabilityCache.value;
  }
  try {
    await trendingGifs(undefined, undefined);
    gifsAvailabilityCache.value = true;
    return true;
  } catch (error) {
    if (error instanceof ApiError && error.code === 'gifs_unavailable') {
      gifsAvailabilityCache.value = false;
      return false;
    }
    return true;
  }
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
      video.play().catch(() => {});
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
  const [query, setQuery] = useState('');
  const [items, setItems] = useState<GifResult[]>(() => mockItems ?? []);
  const [nextPos, setNextPos] = useState<string | undefined>(undefined);
  const [loading, setLoading] = useState(mockItems === undefined);
  const [loadingMore, setLoadingMore] = useState(false);
  const [unavailable, setUnavailable] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);
  const [visibleIds, setVisibleIds] = useState<ReadonlySet<string>>(
    () =>
      new Set(
        typeof IntersectionObserver === 'undefined'
          ? (mockItems ?? []).map((item) => item.mediaToken)
          : [],
      ),
  );
  const cellRefs = useRef(new Map<string, HTMLDivElement | null>());
  const debounceTimer = useRef<number | undefined>(undefined);
  const inflight = useRef<AbortController | undefined>(undefined);

  const load = useCallback(
    async (search: string, pos: string | undefined, append: boolean) => {
      if (mockItems !== undefined) {
        return;
      }
      inflight.current?.abort();
      const controller = new AbortController();
      inflight.current = controller;
      if (append) {
        setLoadingMore(true);
      } else {
        setLoading(true);
        setError(undefined);
      }
      try {
        const page =
          search.trim() === ''
            ? await trendingGifs(pos, controller.signal)
            : await searchGifs(search.trim(), pos, controller.signal);
        if (controller.signal.aborted) {
          return;
        }
        setItems((previous) => (append ? [...previous, ...page.items] : page.items));
        setNextPos(page.nextPos);
        setUnavailable(false);
      } catch (requestError) {
        if (requestError instanceof DOMException && requestError.name === 'AbortError') {
          return;
        }
        if (requestError instanceof ApiError && requestError.code === 'gifs_unavailable') {
          setUnavailable(true);
        } else {
          setError('Could not load GIFs. Try again.');
        }
      } finally {
        if (!controller.signal.aborted) {
          setLoading(false);
          setLoadingMore(false);
        }
      }
    },
    [mockItems],
  );

  // Trending on open, then debounced search: one effect schedules the load
  // (immediately for the first run, debounced afterwards), cancelling the
  // in-flight request. The load itself runs from the timer, never
  // synchronously in the effect.
  const firstRun = useRef(true);
  useEffect(() => {
    if (mockItems !== undefined) {
      return;
    }
    window.clearTimeout(debounceTimer.current);
    const delay = firstRun.current ? 0 : SEARCH_DEBOUNCE_MS;
    firstRun.current = false;
    debounceTimer.current = window.setTimeout(() => {
      void load(query, undefined, false);
    }, delay);
    return () => window.clearTimeout(debounceTimer.current);
  }, [query, load, mockItems]);

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

  const loadMore = useCallback(() => {
    if (nextPos !== undefined && !loadingMore && !loading) {
      void load(query, nextPos, true);
    }
  }, [nextPos, loadingMore, loading, load, query]);

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
          value={query}
          onChange={(event) => setQuery(event.target.value)}
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
          <StateMessage
            kind="error"
            title={error}
            action={{ label: 'Retry', onClick: () => void load(query, undefined, false) }}
          />
        </div>
      ) : items.length === 0 ? (
        <div className="flex h-[180px] flex-col items-center justify-center gap-1 px-4 text-center">
          <p className="text-[13px] text-muted-foreground">
            {query.trim() === ''
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
