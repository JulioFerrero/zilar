import { type ChatSummary, type UiMessage } from '@zilar/chat-core';
import { createContext, useContext, type MouseEvent, type ReactNode } from 'react';
import { useMediaRetry } from '@/lib/media-retry';
import { cn } from '@/lib/utils';
import { useChatStoreApi } from '@/store/ChatStoreProvider';
import { useMediaViewer } from '../media/MediaViewer';

interface AlbumPhoto {
  message: UiMessage;
  messageId: string;
  url: string;
  alt: string;
}

const AlbumMembersContext = createContext<readonly UiMessage[] | null>(null);

export function useAlbumMembers(): readonly UiMessage[] | null {
  return useContext(AlbumMembersContext);
}

export function AlbumMembersProvider({
  messages,
  children,
}: {
  messages: readonly UiMessage[] | null;
  children: ReactNode;
}) {
  return <AlbumMembersContext.Provider value={messages}>{children}</AlbumMembersContext.Provider>;
}

/**
 * The store's sanitizer downgrades an untrusted host to `kind: 'file'`, so a
 * plain `<img>` here never loads bytes from a peer's arbitrary host.
 */
function albumPhotos(messages: readonly UiMessage[]): AlbumPhoto[] {
  return messages
    .filter((message) => message.album !== undefined)
    .sort((a, b) => (a.album?.index ?? 0) - (b.album?.index ?? 0))
    .flatMap((message) => {
      if (message.image !== undefined) {
        return [{ message, messageId: message.id, url: message.image.url, alt: 'Photo' }];
      }
      if (message.attachment !== undefined && message.attachment.kind === 'image') {
        return [
          {
            message,
            messageId: message.id,
            url: message.attachment.url,
            alt: message.attachment.name,
          },
        ];
      }
      return [];
    });
}

function AlbumTile({
  chatId,
  photo,
  albumIds,
  className,
  hidden,
}: {
  chatId: string;
  photo: AlbumPhoto;
  albumIds: readonly string[];
  className: string;
  hidden?: number | undefined;
}) {
  const media = useMediaRetry(chatId, photo.url);
  const storeApi = useChatStoreApi();
  const openViewer = useMediaViewer();
  const failed = photo.message.failed === true || photo.message.status === 'failed';

  const open = (event: MouseEvent<HTMLButtonElement>): void => {
    if (openViewer === null) {
      return;
    }
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
      return;
    }
    event.preventDefault();
    openViewer({ chatId, messageId: photo.messageId, albumIds });
  };

  return (
    <div className={cn('relative overflow-hidden border border-edge bg-well', className)}>
      <button
        type="button"
        aria-label={`View ${photo.alt}`}
        onClick={open}
        className="absolute inset-0 h-full w-full"
      >
        {media.unavailable ? (
          <span className="flex h-full w-full items-center justify-center text-[12px] text-muted-foreground">
            Image unavailable
          </span>
        ) : (
          <>
            <img
              src={media.src}
              alt={photo.alt}
              loading="lazy"
              onLoad={media.onLoad}
              onError={media.onError}
              className="h-full w-full object-cover"
            />
            {media.preview !== undefined && !media.loaded && (
              <img
                src={media.preview}
                alt=""
                aria-hidden
                className="absolute inset-0 h-full w-full object-cover"
              />
            )}
          </>
        )}
        {hidden !== undefined && (
          <span className="absolute inset-0 flex items-center justify-center bg-black/55 text-[20px] font-semibold text-white">
            +{hidden}
          </span>
        )}
      </button>
      {media.unavailable && (
        <div className="absolute inset-x-0 bottom-0 flex items-center justify-center bg-black/60 py-1">
          <button
            type="button"
            aria-label={`Retry ${photo.alt}`}
            onClick={media.retry}
            className="text-[11px] font-semibold text-white underline"
          >
            Retry
          </button>
        </div>
      )}
      {failed && (
        <div className="absolute inset-x-0 bottom-0 flex items-center justify-center gap-2 bg-black/60 px-1 py-1 text-[11px] text-white">
          <span>Upload failed</span>
          <button
            type="button"
            aria-label="Retry upload"
            onClick={() => storeApi.getState().retryAttachment(chatId, photo.messageId)}
            className="font-semibold underline"
          >
            Retry
          </button>
        </div>
      )}
    </div>
  );
}

export function AlbumGrid({ message, chat }: { message: UiMessage; chat: ChatSummary }) {
  const provided = useAlbumMembers();
  const photos = albumPhotos(provided ?? [message]);
  const ids = photos.map((photo) => photo.messageId);
  const first = photos[0];

  if (photos.length === 0 || first === undefined) {
    return null;
  }
  if (photos.length === 1) {
    return (
      <div>
        <AlbumTile
          chatId={chat.id}
          photo={first}
          albumIds={ids}
          className="aspect-[4/3] w-[300px] max-w-full rounded-[12px]"
        />
      </div>
    );
  }
  if (photos.length === 2) {
    return (
      <div className="grid w-[320px] max-w-full grid-cols-2 gap-0.5">
        {photos.map((photo) => (
          <AlbumTile
            key={photo.messageId}
            chatId={chat.id}
            photo={photo}
            albumIds={ids}
            className="aspect-square rounded-[10px]"
          />
        ))}
      </div>
    );
  }
  if (photos.length === 3) {
    const [large, top, bottom] = photos;
    return (
      <div className="grid h-[320px] w-[320px] max-w-full grid-cols-2 grid-rows-2 gap-0.5">
        {large !== undefined && (
          <AlbumTile
            chatId={chat.id}
            photo={large}
            albumIds={ids}
            className="row-span-2 rounded-[10px]"
          />
        )}
        {top !== undefined && (
          <AlbumTile chatId={chat.id} photo={top} albumIds={ids} className="rounded-[10px]" />
        )}
        {bottom !== undefined && (
          <AlbumTile chatId={chat.id} photo={bottom} albumIds={ids} className="rounded-[10px]" />
        )}
      </div>
    );
  }
  const shown = photos.slice(0, 4);
  const total = Math.max(message.album?.count ?? 0, photos.length);
  const hidden = photos.length > 4 ? total - 4 : undefined;
  return (
    <div className="grid w-[320px] max-w-full grid-cols-2 gap-0.5">
      {shown.map((photo, index) => (
        <AlbumTile
          key={photo.messageId}
          chatId={chat.id}
          photo={photo}
          albumIds={ids}
          className="aspect-square rounded-[10px]"
          {...(hidden !== undefined && index === shown.length - 1 ? { hidden } : {})}
        />
      ))}
    </div>
  );
}
