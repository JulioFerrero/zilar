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
  now?: () => number;
  uploadLimiter?: { allow: (key: string) => boolean };
}
