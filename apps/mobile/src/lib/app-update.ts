/**
 * Phones install from GitHub release APKs, so an asset URL outside `DOWNLOAD_PREFIX` is rejected.
 */

export const RELEASES_LATEST_URL =
  'https://api.github.com/repos/JulioFerrero/zilar/releases/latest';

/** The only origin a release APK may be downloaded from. */
export const DOWNLOAD_PREFIX = 'https://github.com/JulioFerrero/zilar/releases/download/';

export interface LatestRelease {
  /** `major.minor.patch`, without the tag's leading `v`. */
  version: string;
  apkUrl: string;
  sizeBytes: number;
}

/** A published tag: `v` and three numeric parts, nothing else. */
const TAG_PATTERN = /^v\d+\.\d+\.\d+$/;

const VERSION_PATTERN = /^v?(\d+)\.(\d+)\.(\d+)$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function findApk(
  assets: readonly unknown[],
  tag: string,
): { apkUrl: string; sizeBytes: number } | null {
  const wanted = [`zilar-${tag}-arm64.apk`, `zilar-${tag}-universal.apk`];
  for (const name of wanted) {
    const asset = assets.find((entry) => isRecord(entry) && entry.name === name);
    if (asset === undefined || !isRecord(asset)) {
      continue;
    }
    const url = asset.browser_download_url;
    const size = asset.size;
    if (
      typeof url === 'string' &&
      url.startsWith(DOWNLOAD_PREFIX) &&
      typeof size === 'number' &&
      Number.isFinite(size) &&
      size > 0
    ) {
      return { apkUrl: url, sizeBytes: size };
    }
  }
  return null;
}

/**
 * `null` when the body is malformed, the tag is not `vX.Y.Z`, or no APK comes from our own download origin.
 */
export function parseLatestRelease(json: unknown): LatestRelease | null {
  if (!isRecord(json)) {
    return null;
  }
  const tag = json.tag_name;
  if (typeof tag !== 'string' || !TAG_PATTERN.test(tag)) {
    return null;
  }
  const assets = json.assets;
  if (!Array.isArray(assets)) {
    return null;
  }
  const apk = findApk(assets, tag);
  if (apk === null) {
    return null;
  }
  return { version: tag.slice(1), ...apk };
}

function versionParts(thing: string): [number, number, number] | null {
  const match = VERSION_PATTERN.exec(thing.trim());
  if (match === null) {
    return null;
  }
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

/**
 * A malformed version on either side is never newer, so a bad payload cannot trigger an update prompt.
 */
export function isNewer(latest: string, installed: string): boolean {
  const next = versionParts(latest);
  const current = versionParts(installed);
  if (next === null || current === null) {
    return false;
  }
  for (let part = 0; part < 3; part += 1) {
    const a = next[part] ?? 0;
    const b = current[part] ?? 0;
    if (a !== b) {
      return a > b;
    }
  }
  return false;
}
