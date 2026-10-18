import type { Auth } from '../auth/auth';
import type { ServerConfig } from '../config/load';
import type { AuditRecorder } from '../audit/recorder';
import type { ServerDatabase } from '../db/client';

export interface AvatarsRoutesDependencies {
  auth: Auth;
  db: ServerDatabase;
  config: ServerConfig;
  storageDir: string;
  audit?: AuditRecorder;
  now?: () => number;
  uploadLimiter?: { allow: (key: string) => boolean };
}
