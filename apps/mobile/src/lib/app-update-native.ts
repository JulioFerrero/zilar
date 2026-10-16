// effect-plain: the Android updater's native seam is the promise API of expo-file-system, expo-network, expo-intent-launcher and expo-secure-store; the store wraps it
/**
 * The native half of the Android in-app updater (T-1724): fetch GitHub's
 * latest release, stream the arm64 APK into the cache directory, hand it to
 * the system installer, and remember the last check, the snooze and the
 * downloaded version in SecureStore.
 *
 * `expo-secure-store` is imported dynamically, like `push/last-received.ts`,
 * because it is a native module. `fetchWithTimeout` uses an `AbortController`
 * timer rather than `AbortSignal.timeout`, which Hermes may lack.
 */

import { File, Paths } from 'expo-file-system';
import { createDownloadResumable, getContentUriAsync } from 'expo-file-system/legacy';
import * as IntentLauncher from 'expo-intent-launcher';
import * as Network from 'expo-network';

import { parseLatestRelease, RELEASES_LATEST_URL, type LatestRelease } from './app-update';
import { fetchWithTimeout } from './effect/fetch-timeout';

/** The update check waits this long before it gives up. */
const CHECK_TIMEOUT_MS = 10_000;

/** `Intent.FLAG_GRANT_READ_URI_PERMISSION`. */
const FLAG_GRANT_READ_URI_PERMISSION = 1;

/** `Intent.ACTION_VIEW` (expo-intent-launcher's enum has no constant). */
const ACTION_VIEW = 'android.intent.action.VIEW';

/** Android's package installer MIME type. */
const APK_MIME_TYPE = 'application/vnd.android.package-archive';

/** The single cache file the download overwrites on each attempt. */
const APK_FILE_NAME = 'zilar-update.apk';

/** SecureStore keys for the throttle, the snooze and the downloaded version. */
export const UPDATE_LAST_CHECK_KEY = 'zilar.update.lastCheck';
export const UPDATE_SNOOZED_KEY = 'zilar.update.snoozed';
export const UPDATE_DOWNLOADED_KEY = 'zilar.update.downloaded';

export interface SnoozedUpdate {
  /** The version the user asked to defer. */
  version: string;
  /** When the snooze expires, as an ISO time. */
  until: string;
}

/** A download attempt: its eventual file URI, or `null` when cancelled. */
export interface ApkDownload {
  result: Promise<string | null>;
  cancel: () => void;
}

function secureStore(): Promise<typeof import('expo-secure-store')> {
  return import('expo-secure-store');
}

/** The one cache file the updater downloads into. */
function apkFile(): File {
  return new File(Paths.cache, APK_FILE_NAME);
}

/** The cached APK's `file://` URI, whether or not it exists. */
export function apkFileUri(): string {
  return apkFile().uri;
}

/** True when a downloaded APK is present in the cache. */
export function apkFileExists(): boolean {
  try {
    return apkFile().exists;
  } catch {
    return false;
  }
}

/** Removes the cached APK, best effort; a missing file is fine. */
export function deleteApk(): void {
  try {
    const file = apkFile();
    if (file.exists) {
      file.delete();
    }
  } catch {
    // The system clears the cache on its own eventually.
  }
}

/**
 * True on Wi-Fi or Ethernet, where streaming the 67 MB APK costs the user
 * nothing. Any other connection (or a failed probe) is treated as metered, so
 * the app asks before downloading.
 */
export async function isUnmeteredConnection(): Promise<boolean> {
  try {
    const state = await Network.getNetworkStateAsync();
    return (
      state.type === Network.NetworkStateType.WIFI ||
      state.type === Network.NetworkStateType.ETHERNET
    );
  } catch {
    return false;
  }
}

/**
 * The latest release, or `null` when GitHub has nothing we can install. A
 * network or HTTP failure rejects so the caller can surface its own message.
 */
export async function checkLatest(): Promise<LatestRelease | null> {
  const response = await fetchWithTimeout(
    fetch,
    RELEASES_LATEST_URL,
    { headers: { Accept: 'application/vnd.github+json' } },
    CHECK_TIMEOUT_MS,
  );
  if (!response.ok) {
    throw new Error(`release check answered ${response.status}`);
  }
  const body: unknown = await response.json();
  return parseLatestRelease(body);
}

/**
 * Streams `url` into the cache directory as `zilar-update.apk`, calling
 * `onProgress` with 0–1 as bytes arrive (unknown totals are skipped). The
 * returned `result` resolves to the file's `file://` URI, or `null` when
 * `cancel()` stopped it. Only release URLs are ever passed in
 * (`app-update.ts` rejects anything else).
 */
export function downloadApk(url: string, onProgress: (progress: number) => void): ApkDownload {
  const destination = apkFile();
  const resumable = createDownloadResumable(url, destination.uri, {}, (data) => {
    const total = data.totalBytesExpectedToWrite;
    if (total > 0) {
      onProgress(Math.max(0, Math.min(1, data.totalBytesWritten / total)));
    }
  });
  const result = resumable.downloadAsync().then((done) => done?.uri ?? null);
  return {
    result,
    cancel: () => {
      void resumable.cancelAsync().catch(() => undefined);
    },
  };
}

/**
 * Opens the downloaded APK with the system package installer. The installer
 * itself asks for "allow installs from this source" the first time; we only
 * hand it the `content://` URI with read permission.
 */
export async function installApk(fileUri: string): Promise<void> {
  const contentUri = await getContentUriAsync(fileUri);
  await IntentLauncher.startActivityAsync(ACTION_VIEW, {
    data: contentUri,
    type: APK_MIME_TYPE,
    flags: FLAG_GRANT_READ_URI_PERMISSION,
  });
}

/** The last check time as its stored ISO string, or `null` when unreadable. */
export async function readLastCheck(): Promise<string | null> {
  try {
    const store = await secureStore();
    return await store.getItemAsync(UPDATE_LAST_CHECK_KEY);
  } catch {
    return null;
  }
}

/** Records that a check just ran. Best effort: storage never breaks a check. */
export async function writeLastCheck(at: Date = new Date()): Promise<void> {
  try {
    const store = await secureStore();
    await store.setItemAsync(UPDATE_LAST_CHECK_KEY, at.toISOString());
  } catch {
    // A storage failure just means the next auto check runs unthrottled.
  }
}

/** The stored snooze, or `null` when absent or malformed. */
export async function readSnoozed(): Promise<SnoozedUpdate | null> {
  let raw: string | null;
  try {
    const store = await secureStore();
    raw = await store.getItemAsync(UPDATE_SNOOZED_KEY);
  } catch {
    return null;
  }
  if (raw === null) {
    return null;
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) {
      return null;
    }
    const { version, until } = parsed as Record<string, unknown>;
    if (typeof version !== 'string' || typeof until !== 'string') {
      return null;
    }
    return { version, until };
  } catch {
    return null;
  }
}

/** Persists a snooze; best effort, so a storage failure never blocks "later". */
export async function writeSnoozed(snoozed: SnoozedUpdate): Promise<void> {
  try {
    const store = await secureStore();
    await store.setItemAsync(UPDATE_SNOOZED_KEY, JSON.stringify(snoozed));
  } catch {
    // The version simply reappears on the next auto check.
  }
}

/** The version whose APK is cached, or `null` when none or malformed. */
export async function readDownloaded(): Promise<string | null> {
  let raw: string | null;
  try {
    const store = await secureStore();
    raw = await store.getItemAsync(UPDATE_DOWNLOADED_KEY);
  } catch {
    return null;
  }
  if (raw === null) {
    return null;
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) {
      return null;
    }
    const version = (parsed as Record<string, unknown>).version;
    return typeof version === 'string' ? version : null;
  } catch {
    return null;
  }
}

/** Remembers which version the cached APK is, best effort. */
export async function writeDownloaded(version: string): Promise<void> {
  try {
    const store = await secureStore();
    await store.setItemAsync(UPDATE_DOWNLOADED_KEY, JSON.stringify({ version }));
  } catch {
    // Without the marker the next check would download again; harmless.
  }
}

/** Forgets the downloaded version, best effort. */
export async function clearDownloaded(): Promise<void> {
  try {
    const store = await secureStore();
    await store.deleteItemAsync(UPDATE_DOWNLOADED_KEY);
  } catch {
    // A stale marker only costs one redundant download.
  }
}
