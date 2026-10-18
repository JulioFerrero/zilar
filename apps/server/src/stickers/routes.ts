import type { AuditRecorder } from '../audit/recorder';
import type { ServerConfig } from '../config/load';
import type { Auth } from '../auth/auth';
import type { ServerDatabase } from '../db/client';
import type { StickerConverter } from './convert';

export interface StickersRoutesDependencies {
  auth: Auth;
  db: ServerDatabase;
  config: ServerConfig;
  storageDir: string;
  audit?: AuditRecorder;
  now?: () => number;
  uploadLimiter?: { allow: (key: string) => boolean };
  importLimiter?: { allow: (key: string) => boolean };
  telegramClient?: import('./telegram/set').TelegramClient;
  converter?: StickerConverter;
  /**
   * Resolves the bot token per request: the env value wins when set, else
   * the stored integrations value, else none. `app.ts` wires the integrations
   * resolver; tests inject a fixed value. Absent = the legacy env-only read.
   */
  getBotToken?: () => Promise<string | null>;
}
