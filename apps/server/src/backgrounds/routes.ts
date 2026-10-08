import type { Auth } from '../auth/auth';
import type { ServerDatabase } from '../db/client';

export interface BackgroundsRoutesDependencies {
  auth: Auth;
  db: ServerDatabase;
  storageDir: string;
  /** Injected in tests so the rate-limit window can advance without waiting. */
  now?: () => number;
  /** Overrides the upload limiter (tests inject a big budget or a block). */
  uploadLimiter?: { allow: (key: string) => boolean };
}
