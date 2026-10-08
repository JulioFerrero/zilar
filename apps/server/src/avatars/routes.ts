// The avatars Hono router moved onto the Effect `HttpApi` adapter (T-0576):
// `createAvatarsApi` in `./api` serves every route. This module keeps the
// `AvatarsRoutesDependencies` interface (re-exported) so `app.ts` can reuse
// the type; the Hono factory and the old `readCapped` are gone.
import type { Auth } from '../auth/auth';
import type { ServerConfig } from '../config';
import type { ServerDatabase } from '../db/client';
import type { AuditRecorder } from '../audit/service';

export interface AvatarsRoutesDependencies {
  auth: Auth;
  db: ServerDatabase;
  config: ServerConfig;
  storageDir: string;
  audit?: AuditRecorder;
  /** Injected in tests so the rate-limit window can advance without waiting. */
  now?: () => number;
  /** Overrides the upload limiter (tests inject a big budget or a block). */
  uploadLimiter?: { allow: (key: string) => boolean };
}
