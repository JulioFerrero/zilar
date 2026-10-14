import { photosOf, type UiMessage, type ViewerPhoto } from '@zilar/chat-core';
import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';
import Lightbox from 'yet-another-react-lightbox';
import Counter from 'yet-another-react-lightbox/plugins/counter';
import Zoom from 'yet-another-react-lightbox/plugins/zoom';
import 'yet-another-react-lightbox/styles.css';
import 'yet-another-react-lightbox/plugins/counter.css';
import { useChatSelector } from '@/store/ChatStoreProvider';
import './lightbox-theme.css';
import { viewerSlides } from './viewerSlides';

/** The chat to step through, and the photo the viewer starts on. */
export interface MediaViewerTarget {
  chatId: string;
  messageId: string;
  /**
   * An album opened from a tile (T-1268): its photo ids, in index order. When
   * present the viewer steps through the album first, then the rest of the chat
   * (§4.5). Absent for a single-photo open.
   */
  albumIds?: readonly string[] | undefined;
}

export type OpenMediaViewer = (target: MediaViewerTarget) => void;

const MediaViewerContext = createContext<OpenMediaViewer | null>(null);

/** The opener for the chat's photo viewer; null outside a `MediaViewerProvider`. */
export function useMediaViewer(): OpenMediaViewer | null {
  return useContext(MediaViewerContext);
}

const EMPTY_MESSAGES: readonly UiMessage[] = [];

/**
 * The chat's photo viewer (T-1232): a full-screen overlay opened from the
 * message list by `ImageMessage` and `AlbumGrid` through `useMediaViewer`. One
 * provider serves the whole list.
 *
 * T-1343 rewrote it on `yet-another-react-lightbox` (the twin of the phone's
 * T-1341 library move): the Zoom plugin gives wheel and trackpad-pinch zoom
 * toward the cursor, double-click zoom and drag-pan, the carousel gives the
 * swipe and the edge arrows, and the Counter plugin gives the "3 / 12" badge.
 * Escape and a backdrop click close, and the toolbar keeps an "Open original"
 * link.
 */
export function MediaViewerProvider({ children }: { children: ReactNode }) {
  const [target, setTarget] = useState<MediaViewerTarget | null>(null);
  return (
    <MediaViewerContext.Provider value={setTarget}>
      {children}
      {target !== null && (
        <MediaViewer
          key={`${target.chatId}:${target.messageId}`}
          target={target}
          onClose={() => setTarget(null)}
        />
      )}
    </MediaViewerContext.Provider>
  );
}

function MediaViewer({ target, onClose }: { target: MediaViewerTarget; onClose: () => void }) {
  // The same slice the list renders (MessageList.tsx:68).
  const stored = useChatSelector((state) => state.messagesByChat[target.chatId]);
  const photos = useMemo(() => {
    const all = photosOf(stored ?? EMPTY_MESSAGES);
    const scope = target.albumIds;
    if (scope === undefined) {
      return all;
    }
    const inScope = new Set(scope);
    const album = scope
      .map((id) => all.find((photo) => photo.messageId === id))
      .filter((photo): photo is ViewerPhoto => photo !== undefined);
    return [...album, ...all.filter((photo) => !inScope.has(photo.messageId))];
  }, [stored, target.albumIds]);
  const slides = useMemo(() => viewerSlides(target.chatId, photos), [target.chatId, photos]);
  // The photo the viewer opens on. The carousel owns the current slide, and
  // `on.view` mirrors it back into `index`; passing that back in as the
  // controlled `index` (the library's "Tracking Slide Index" pattern) keeps the
  // viewer on the same slide when `slides` gets a new reference (a message
  // arriving in the chat), which would otherwise snap it back to `startIndex`.
  const startIndex = useMemo(
    () =>
      Math.max(
        0,
        photos.findIndex((photo) => photo.messageId === target.messageId),
      ),
    [photos, target.messageId],
  );
  const [index, setIndex] = useState(startIndex);

  if (slides.length === 0) {
    return null;
  }
  const current = slides[index];

  return (
    <Lightbox
      open
      close={onClose}
      index={index}
      slides={slides}
      plugins={[Zoom, Counter]}
      controller={{ closeOnBackdropClick: true }}
      carousel={{ finite: true, padding: 0 }}
      zoom={{ scrollToZoom: true, maxZoomPixelRatio: 2 }}
      labels={{ Lightbox: 'Photo viewer' }}
      on={{ view: ({ index: next }) => setIndex(next) }}
      toolbar={{
        buttons: [
          current !== undefined && (
            <a
              key="open-original"
              href={current.src}
              target="_blank"
              rel="noopener noreferrer"
              className="yarl__open_original"
            >
              Open original
            </a>
          ),
          'close',
        ],
      }}
    />
  );
}
