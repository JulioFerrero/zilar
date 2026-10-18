import { photosOf, type UiMessage, type ViewerPhoto } from '@zilar/chat-core';
import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';
import Lightbox, { type SlideImage } from 'yet-another-react-lightbox';
import Counter from 'yet-another-react-lightbox/plugins/counter';
import Zoom from 'yet-another-react-lightbox/plugins/zoom';
import 'yet-another-react-lightbox/styles.css';
import 'yet-another-react-lightbox/plugins/counter.css';
import { useChatSelector } from '@/store/ChatStoreProvider';
import './lightbox-theme.css';
import { mediaSrc } from '@/lib/attachments';

/**
 * Every URL goes through `mediaSrc`: a same-origin `/upload/` photo loads via
 * `GET /api/files`, where the server checks the session and chat membership;
 * every other URL keeps its own source. An untrusted host is never fetched:
 * `photosOf` only returns images, and the sanitizer downgrades a peer's
 * non-trusted host to `file` first.
 */
function viewerSlides(chatId: string, photos: readonly ViewerPhoto[]): SlideImage[] {
  return photos.map((photo) => ({ src: mediaSrc(chatId, photo.url), alt: photo.alt }));
}

export interface MediaViewerTarget {
  chatId: string;
  messageId: string;
  albumIds?: readonly string[] | undefined;
}

export type OpenMediaViewer = (target: MediaViewerTarget) => void;

const MediaViewerContext = createContext<OpenMediaViewer | null>(null);

export function useMediaViewer(): OpenMediaViewer | null {
  return useContext(MediaViewerContext);
}

const EMPTY_MESSAGES: readonly UiMessage[] = [];

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
  // The carousel owns the current slide and `on.view` mirrors it back into
  // `index`; passing that back as the controlled `index` (the library's
  // "Tracking Slide Index" pattern) keeps the viewer on the same slide when
  // `slides` gets a new reference, which would otherwise snap to `startIndex`.
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
