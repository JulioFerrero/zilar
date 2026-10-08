// The stickers Hono router moved onto the Effect `HttpApi` adapter
// (T-0582 part A, T-0602 part B): `createStickersApi` in `./api` serves every
// route. This module keeps the `StickersRoutesDependencies` interface and the
// rate-limit constants re-exported, so `app.ts` and `./api` keep their
// imports; the Hono factory, `readCapped` and the zod upload-form schema are
// gone.
import type { AuditRecorder } from '../audit/service';
import type { Auth } from '../auth/auth';
import type { ServerConfig } from '../config';
import type { ServerDatabase } from '../db/client';

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
  /** Injected in tests so the rate-limit window can advance without waiting. */
  now?: () => number;
  /** Overrides the upload limiter (tests inject a big budget for cap tests). */
  uploadLimiter?: { allow: (key: string) => boolean };
  /** Overrides the Telegram import limiter (tests inject a pass or a block). */
  importLimiter?: { allow: (key: string) => boolean };
  /** Injected in tests so the import never touches the network. */
  telegramClient?: import('./telegram-import').TelegramClient;
  /**
   * Resolves the bot token per request: the env value wins when set, else
   * the stored integrations value, else none. `app.ts` wires the integrations
   * resolver; tests inject a fixed value. Absent = the legacy env-only read.
   */
  getBotToken?: () => Promise<string | null>;
}
