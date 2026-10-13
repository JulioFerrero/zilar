import { Effect } from 'effect';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { createGalleryReader } from '@/lib/attachment-native';
import type {
  GalleryAsset,
  GalleryPage,
  GalleryPickResult,
  GalleryReader,
} from '@/lib/attachment-native';
import type { PickedFile } from '@/lib/attachment-ports';

/** Assets fetched per page, about one comfortable screen of the 3-column grid. */
export const GALLERY_PAGE_SIZE = 60;

/**
 * The Gallery tab's state machine: `loading` while the first page is on its
 * way, `ready` once the grid is shown, `denied` when the user refused the
 * photo permission, `error` when the library read failed. The reader is a seam
 * (the default is the real `expo-media-library` one) and the sort is newest
 * first, so the first tile is the photo the user just took.
 */
export type GalleryStatus = 'loading' | 'ready' | 'denied' | 'error';

export type GalleryAssets = {
  status: GalleryStatus;
  assets: GalleryAsset[];
  hasMore: boolean;
  loadMore: () => void;
  /**
   * Stages one pick: every selected asset as a `PickedFile` in the order the
   * user picked them, or the first fixed size sentence when any asset is empty
   * or over the cap (the same all-or-nothing rule as the library pick).
   */
  stageAssets: (selected: readonly GalleryAsset[]) => Promise<GalleryStageResult>;
};

/** The result of staging one pick, mirroring the library pick's size failure. */
export type GalleryStageResult =
  { status: 'picked'; files: PickedFile[] } | { status: 'error'; message: string };

/** One page read, folded to `undefined` so the hook never propagates a cause. */
function readPage(
  reader: GalleryReader,
  after: string | undefined,
): Effect.Effect<GalleryPage | undefined> {
  return Effect.tryPromise({
    try: () => reader.loadPage({ after, pageSize: GALLERY_PAGE_SIZE }),
    catch: () => undefined,
  }).pipe(Effect.orElseSucceed(() => undefined));
}

/**
 * Reads the recent assets and pages them as the grid scrolls. The request
 * starts on mount (the sheet mounts this only while it is open), so switching
 * from the File tab and back keeps the already-loaded page.
 */
export function useGalleryAssets(readerProp?: GalleryReader | undefined): GalleryAssets {
  const reader = useMemo(() => readerProp ?? createGalleryReader(), [readerProp]);
  const [status, setStatus] = useState<GalleryStatus>('loading');
  const [assets, setAssets] = useState<GalleryAsset[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const cursorRef = useRef<string | undefined>(undefined);
  const loadingRef = useRef(false);
  const startedRef = useRef(false);

  const loadMore = useCallback(() => {
    if (loadingRef.current) {
      return;
    }
    loadingRef.current = true;
    Effect.runFork(
      readPage(reader, cursorRef.current).pipe(
        Effect.tap((page) =>
          Effect.sync(() => {
            if (page === undefined) {
              // A later page that fails keeps the grid already on screen; only
              // the first page turns into the error state.
              setHasMore(false);
              setStatus((current) => (current === 'ready' ? current : 'error'));
              return;
            }
            cursorRef.current = page.endCursor;
            setAssets((current) => [...current, ...page.assets]);
            setHasMore(page.hasNextPage);
            setStatus('ready');
          }),
        ),
        Effect.ensuring(
          Effect.sync(() => {
            loadingRef.current = false;
          }),
        ),
      ),
    );
  }, [reader]);

  useEffect(() => {
    if (startedRef.current) {
      return;
    }
    startedRef.current = true;
    Effect.runFork(
      Effect.tryPromise({
        try: () => reader.requestPermission(),
        catch: () => false,
      }).pipe(
        Effect.orElseSucceed(() => false),
        Effect.tap((granted) =>
          Effect.sync(() => {
            if (granted) {
              loadMore();
            } else {
              setStatus('denied');
            }
          }),
        ),
      ),
    );
  }, [reader, loadMore]);

  const stageAssets = useCallback(
    (selected: readonly GalleryAsset[]) =>
      Effect.runPromise(
        Effect.forEach(selected, (asset) => Effect.promise(() => reader.toPickedFile(asset))).pipe(
          Effect.map((results): GalleryStageResult => {
            const failed = results.find(
              (result): result is Extract<GalleryPickResult, { status: 'error' }> =>
                result.status === 'error',
            );
            if (failed !== undefined) {
              return { status: 'error', message: failed.message };
            }
            return {
              status: 'picked',
              files: results.flatMap((result) => (result.status === 'picked' ? [result.file] : [])),
            };
          }),
        ),
      ),
    [reader],
  );

  return { status, assets, hasMore, loadMore, stageAssets };
}
