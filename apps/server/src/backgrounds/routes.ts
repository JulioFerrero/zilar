import type { Auth } from '../auth/auth';
import type { ServerDatabase } from '../db/client';

export interface BackgroundsRoutesDependencies {
  auth: Auth;
  db: ServerDatabase;
  storageDir: string;
  now?: () => number;
  uploadLimiter?: { allow: (key: string) => boolean };
}
