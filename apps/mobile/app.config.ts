import { existsSync } from 'node:fs';
import { join } from 'node:path';

import type { ConfigContext, ExpoConfig } from 'expo/config';

/** The Firebase Android config Julio downloads for a build (plan §4.2). */
const GOOGLE_SERVICES_FILE = 'google-services.json';

/**
 * Extends `app.json` (T-1139). The Firebase file is not committed (the repo is
 * public and each self-hoster brings their own), so the native build only points
 * at it when it is present on disk. Without the file the config is exactly
 * `app.json`, so a build that does not use FCM still works.
 */
export default ({ config, projectRoot }: ConfigContext): ExpoConfig => {
  const googleServicesPath = join(projectRoot, GOOGLE_SERVICES_FILE);
  if (!existsSync(googleServicesPath)) {
    return config as ExpoConfig;
  }
  return {
    ...config,
    android: {
      ...config.android,
      googleServicesFile: `./${GOOGLE_SERVICES_FILE}`,
    },
  } as ExpoConfig;
};
