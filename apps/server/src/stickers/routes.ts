import type { AuditRecorder } from '../audit/service';
import type { Auth } from '../auth/auth';
import type { ServerConfig } from '../config';
import type { ServerDatabase } from '../db/client';
import type { StickerConverter } from './convert';

export const STICKER_UPLOAD_RATE_LIMIT_MAX = 60;
export const STICKER_UPLOAD_RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000;
export const TELEGRAM_IMPORT_RATE_LIMIT_MAX = 3;
export const TELEGRAM_IMPORT_RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000;

export interface StickersRoutesDependencies {
  auth: Auth;
  db: ServerDatabase;
  config: ServerConfig;
  storageDir: string;
  audit?: AuditRecorder;
  now?: () => number;
  uploadLimiter?: { allow: (key: string) => boolean };
  importLimiter?: { allow: (key: string) => boolean };
  telegramClient?: import('./telegram-import').TelegramClient;
  converter?: StickerConverter;
  /**
   * Resolves the bot token per request: the env value wins when set, else
   * the stored integrations value, else none. `app.ts` wires the integrations
   * resolver; tests inject a fixed value. Absent = the legacy env-only read.
   */
  getBotToken?: () => Promise<string | null>;
}
