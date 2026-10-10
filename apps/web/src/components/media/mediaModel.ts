import type { MediaItem, MediaTab } from '@/lib/api';
import { formatFileSize } from '@/lib/attachments';

export const TABS: { value: MediaTab; label: string }[] = [
  { value: 'media', label: 'Media' },
  { value: 'files', label: 'Files' },
  { value: 'links', label: 'Links' },
  { value: 'voice', label: 'Voice' },
];

export const EMPTY_TITLE: Record<MediaTab, string> = {
  media: 'No media yet',
  files: 'No files yet',
  links: 'No links yet',
  voice: 'No voice messages yet',
};

const DATE_FORMAT = new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric' });

function formatDate(at: string): string {
  const date = new Date(at);
  return Number.isNaN(date.getTime()) ? '' : DATE_FORMAT.format(date);
}

export function formatDuration(ms: number | undefined): string {
  if (ms === undefined || !Number.isFinite(ms)) {
    return '';
  }
  const total = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

export function byline(item: MediaItem): string {
  const parts = [formatDate(item.at)];
  if (item.senderName !== '') {
    parts.unshift(item.senderName);
  }
  return parts.filter((part) => part !== '').join(' · ');
}

export function rowSubtitle(item: MediaItem): string {
  const lead =
    item.kind === 'file' && item.size !== undefined ? formatFileSize(item.size) : undefined;
  return [lead, byline(item)].filter((part) => part !== undefined && part !== '').join(' · ');
}

// One message can yield several items (two links in one body), so the key needs
// the kind/reference and the item's position, not just the message id.
export function mediaItemKey(item: MediaItem, index: number): string {
  return `${item.messageId}-${item.kind}-${item.url ?? item.linkUrl ?? ''}-${index}`;
}

/** The chat a row opens items in, and the panel's reactions to a jump. */
export interface JumpTarget {
  readonly chatId: string;
  readonly onStart: () => void;
  readonly onOpened: () => void;
  readonly onFailed: () => void;
}
