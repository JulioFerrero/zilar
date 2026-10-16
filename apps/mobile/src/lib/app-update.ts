/**
 * The pure half of the Android in-app updater (T-1724): reading GitHub's
 * "latest release" payload and comparing versions. Nothing here imports a
 * native module, so it stays testable and reusable by the UI task.
 *
 * Phones install Zilar from the GitHub release APKs, so the update must come
 * from the repo's own release assets and nowhere else: a `browser_download_url`
 * outside `DOWNLOAD_PREFIX` is rejected.
 */

/** GitHub's "latest release" endpoint for the public Zilar repo. */
export const RELEASES_LATEST_URL =
  'https://api.github.com/repos/JulioFerrero/zilar/releases/latest';

/** The only origin a release APK may be downloaded from. */
export const DOWNLOAD_PREFIX = 'https://github.com/JulioFerrero/zilar/releases/download/';

/** A release we can offer: its version and its arm64 APK. */
export interface LatestRelease {
  /** `major.minor.patch`, without the tag's leading `v`. */
  version: string;
  apkUrl: string;
  sizeBytes: number;
}

/** A published tag: `v` and three numeric parts, nothing else. */
const TAG_PATTERN = /^v\d+\.\d+\.\d+$/;

/** A version with an optional leading `v`, as three numeric parts. */
const VERSION_PATTERN = /^v?(\d+)\.(\d+)\.(\d+)$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/** The release asset named for `tag`, preferring arm64 over universal. */
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
 * The release to offer from GitHub's "latest release" body, or `null` when the
 * body is malformed, the tag is not `vX.Y.Z`, or the release carries no APK
 * from our own download origin. Callers treat `null` as "nothing to offer".
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

/** `thing` as `[major, minor, patch]`, or `null` when it is not a version. */
function versionParts(thing: string): [number, number, number] | null {
  const match = VERSION_PATTERN.exec(thing.trim());
  if (match === null) {
    return null;
  }
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

/**
 * True when `latest` is a strictly higher version than `installed`, by a
 * numeric major.minor.patch compare. A missing or malformed version on either
 * side is never "newer", so a bad payload cannot trigger an update prompt.
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
