import { TelegramPackNotFound } from './errors';

export interface TelegramStickerEntry {
  /** Telegram's stable file id (never reused): stored as `source_id`. */
  sourceId: string;
  /** The opaque `file_id` needed for the `getFile` call. Never logged. */
  fileId: string;
  emoji: string | null;
  /** True for animated (`.tgs`) and video (`.webm`) stickers: skipped. */
  animated: boolean;
}

export interface TelegramStickerSet {
  name: string;
  title: string;
  isCustomEmoji: boolean;
  stickers: TelegramStickerEntry[];
}

export interface TelegramClient {
  getMe(): Promise<{ ok: boolean }>;
  getStickerSet(name: string): Promise<TelegramStickerSet>;
  downloadFile(fileId: string): Promise<Uint8Array>;
}

export interface TelegramApiEnvelope {
  ok: boolean;
  result?: unknown;
  description?: string;
  error_code?: number;
  parameters?: { retry_after?: number };
}

const stickerFileSchema = {
  isAnimated(value: unknown): boolean {
    if (value !== null && typeof value === 'object') {
      const record = value as Record<string, unknown>;
      return record.is_animated === true || record.is_video === true;
    }
    return false;
  },
};

function toStickerEntry(raw: unknown): TelegramStickerEntry | undefined {
  if (raw === null || typeof raw !== 'object') {
    return undefined;
  }
  const record = raw as Record<string, unknown>;
  const fileId = typeof record.file_id === 'string' ? record.file_id : '';
  const sourceId = typeof record.file_unique_id === 'string' ? record.file_unique_id : '';
  if (fileId === '' || sourceId === '') {
    return undefined;
  }
  const emoji = typeof record.emoji === 'string' && record.emoji !== '' ? record.emoji : null;
  return { sourceId, fileId, emoji, animated: stickerFileSchema.isAnimated(raw) };
}

export function toStickerSet(name: string, raw: unknown): TelegramStickerSet {
  if (raw === null || typeof raw !== 'object') {
    throw new TelegramPackNotFound();
  }
  const record = raw as Record<string, unknown>;
  const title = typeof record.title === 'string' && record.title !== '' ? record.title : name;
  const isCustomEmoji = record.sticker_type === 'custom_emoji';
  const rawStickers = Array.isArray(record.stickers) ? record.stickers : [];
  const stickers: TelegramStickerEntry[] = [];
  for (const entry of rawStickers) {
    const parsed = toStickerEntry(entry);
    if (parsed !== undefined) {
      stickers.push(parsed);
    }
  }
  return { name, title, isCustomEmoji, stickers };
}
