import { FileText, Image as ImageIcon, Link2, Mic } from 'lucide-react';
import type { MediaItem } from '@/lib/api';
import { mediaSrc, safeHttpUrl } from '@/lib/attachments';
import { Button } from '@/components/ui/button';
import { byline, formatDuration, rowSubtitle, type JumpTarget } from './mediaModel';
import { useShowInChat } from './useShowInChat';

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

export function FileRow({ item, jump }: { item: MediaItem; jump: JumpTarget }) {
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

export function LinkRow({ item, jump }: { item: MediaItem; jump: JumpTarget }) {
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

export function MediaThumb({
  chatId,
  item,
  jump,
}: {
  chatId: string;
  item: MediaItem;
  jump: JumpTarget;
}) {
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
