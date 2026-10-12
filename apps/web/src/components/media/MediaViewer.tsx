import { photosOf, type UiMessage, type ViewerPhoto } from '@zilar/chat-core';
import { ChevronLeft, ChevronRight, X } from 'lucide-react';
import {
  createContext,
  useContext,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from 'react';
import { IconButton } from '@/components/ui/icon-button';
import { useModal } from '@/components/ui/use-modal';
import { mediaSrc } from '@/lib/attachments';
import { useChatSelector } from '@/store/ChatStoreProvider';

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
 * The chat's photo viewer (T-1232): a full-screen overlay on a dark backdrop,
 * opened from the message list by `ImageMessage` through `useMediaViewer`. One
 * provider serves the whole list. The overlay uses the `use-modal` primitive,
 * so Escape closes it, focus is trapped inside and returns to the photo on
 * close; a click on the backdrop, the close key, and ←/→ step between the
 * chat's photos in message order.
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
  const [index, setIndex] = useState(() =>
    Math.max(
      0,
      photos.findIndex((photo) => photo.messageId === target.messageId),
    ),
  );

  const panelRef = useRef<HTMLDivElement>(null);
  const trapTab = useModal({ open: true, onClose, dismissable: true, panelRef });

  if (photos.length === 0) {
    return null;
  }
  const photo = photos[index];
  if (photo === undefined) {
    return null;
  }

  const step = (delta: number): void => {
    setIndex((current) => Math.min(photos.length - 1, Math.max(0, current + delta)));
  };

  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>): void => {
    if (event.key === 'ArrowLeft') {
      event.preventDefault();
      step(-1);
      return;
    }
    if (event.key === 'ArrowRight') {
      event.preventDefault();
      step(1);
      return;
    }
    trapTab(event);
  };

  const src = mediaSrc(target.chatId, photo.url);
  const stop = (event: ReactMouseEvent): void => event.stopPropagation();

  return (
    <div
      ref={panelRef}
      role="dialog"
      aria-modal="true"
      aria-label="Photo viewer"
      tabIndex={-1}
      onKeyDown={onKeyDown}
      className="fixed inset-0 z-50 flex flex-col bg-black/90 outline-none"
    >
      <div className="flex shrink-0 items-center justify-between gap-2 px-4 py-3">
        <span className="text-[13px] tabular-nums text-white/80">
          {index + 1} / {photos.length}
        </span>
        <IconButton aria-label="Close viewer" onClick={onClose}>
          <X className="size-4" aria-hidden="true" />
        </IconButton>
      </div>

      <div className="flex min-h-0 flex-1 items-center justify-center gap-2 p-4" onClick={onClose}>
        <IconButton
          aria-label="Previous photo"
          disabled={index === 0}
          onClick={(event) => {
            stop(event);
            step(-1);
          }}
        >
          <ChevronLeft className="size-5" aria-hidden="true" />
        </IconButton>
        <img
          src={src}
          alt={photo.alt}
          onClick={stop}
          className="max-h-full max-w-full object-contain"
        />
        <IconButton
          aria-label="Next photo"
          disabled={index >= photos.length - 1}
          onClick={(event) => {
            stop(event);
            step(1);
          }}
        >
          <ChevronRight className="size-5" aria-hidden="true" />
        </IconButton>
      </div>

      <div className="flex shrink-0 justify-center px-4 py-3">
        <a
          href={src}
          target="_blank"
          rel="noopener noreferrer"
          className="text-[13px] font-semibold text-white/90 underline"
        >
          Open original
        </a>
      </div>
    </div>
  );
}
