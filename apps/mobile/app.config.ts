import { existsSync } from 'node:fs';
import { join } from 'node:path';

import type { ConfigContext, ExpoConfig } from 'expo/config';

/** The Firebase Android config Julio downloads for a build (plan §4.2). */
const GOOGLE_SERVICES_FILE = 'google-services.json';

/** A non-empty environment variable, or undefined when it is unset or blank. */
function optionalEnv(name: string): string | undefined {
  const value = process.env[name];
  return value === undefined || value.trim() === '' ? undefined : value;
}

/** `ZILAR_VERSION_CODE` as a positive integer, or undefined when unset. */
function versionCodeFromEnv(): number | undefined {
  const raw = optionalEnv('ZILAR_VERSION_CODE');
  if (raw === undefined) {
    return undefined;
  }
  const code = Number(raw);
  if (!Number.isInteger(code) || code <= 0) {
    throw new Error(`ZILAR_VERSION_CODE must be a positive integer, got "${raw}"`);
  }
  return code;
}

/**
 * Extends `app.json` (T-1139). The Firebase file is not committed (the repo is
 * public and each self-hoster brings their own), so the native build only points
 * at it when it is present on disk.
 *
 * T-1354 adds the release-signing plugin and lets the release workflow set the
 * version from the tag through `ZILAR_VERSION_NAME`/`ZILAR_VERSION_CODE`. With
 * those unset the version stays `app.json`'s.
 */
export default ({ config, projectRoot }: ConfigContext): ExpoConfig => {
  const googleServicesPath = join(projectRoot, GOOGLE_SERVICES_FILE);
  const versionName = optionalEnv('ZILAR_VERSION_NAME');
  const versionCode = versionCodeFromEnv();
  return {
    ...config,
    ...(versionName === undefined ? {} : { version: versionName }),
    plugins: [...(config.plugins ?? []), './plugins/with-release-signing'],
    android: {
      ...config.android,
      ...(versionCode === undefined ? {} : { versionCode }),
      ...(existsSync(googleServicesPath)
        ? { googleServicesFile: `./${GOOGLE_SERVICES_FILE}` }
        : {}),
    },
  } as ExpoConfig;
};
