// effect-plain: the updater store is plain module state over the app-update-native promise seam; the download cancel function has no Effect shape
/**
 * The Android in-app updater's shared store (T-1724), with no UI. The root
 * install dialog and the Settings row both read it, so the state lives at
 * module level and is read through `useSyncExternalStore`, the way
 * `blocked-users.ts` does; it is not per-component `useState`. Only one check
 * or download runs at a time, however many components call `useAppUpdate()`.
 *
 * On a check it either downloads quietly on Wi-Fi/Ethernet or asks first on
 * mobile data (Julio's approved flow, `docs/design/mockups/updater/README.md`):
 * the states are `available` (ask), `downloading` (with a `quiet` flag and
 * progress), `ready` (downloaded, ask to install) and `upToDate`, plus the
 * `installing`, `failed` and `idle` in-between states. `lastCheckedAt` rides on
 * every state so the Settings row can show "checked HH:MM".
 *
 * It is deliberately off unless the build is a real Android release: dev and
 * local builds have no `versionCode` and must never fetch or prompt. The UI
 * task calls `startAppUpdateChecks()` once from the root layout.
 */

import Constants from 'expo-constants';
import { useSyncExternalStore } from 'react';
import { AppState, Platform } from 'react-native';

import { isNewer, type LatestRelease } from './app-update';
import {
  apkFileExists,
  apkFileUri,
  checkLatest,
  clearDownloaded,
  deleteApk,
  downloadApk,
  installApk,
  isUnmeteredConnection,
  readDownloaded,
  readLastCheck,
  readSnoozed,
  writeDownloaded,
  writeLastCheck,
  writeSnoozed,
} from './app-update-native';

/** An automatic check runs at most this often. */
const AUTO_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;

/** "Later" hides a version for this long. */
const SNOOZE_MS = 24 * 60 * 60 * 1000;

/** Fixed user-facing messages; a raw error never reaches the UI. */
const CHECK_FAILED_MESSAGE = 'Could not check for updates.';
const DOWNLOAD_FAILED_MESSAGE = 'The update could not be downloaded.';
const INSTALL_FAILED_MESSAGE = 'The update could not be opened.';

/** The updater's screens and the states between them. */
export type AppUpdateStatus =
  | { status: 'idle' }
  | { status: 'checking' }
  | { status: 'upToDate' }
  | { status: 'available'; version: string; sizeBytes: number }
  | { status: 'ready'; version: string; sizeBytes: number; fileUri: string }
  | { status: 'downloading'; version: string; progress: number; quiet: boolean; sizeBytes: number }
  | { status: 'installing'; version: string; sizeBytes: number }
  | { status: 'failed'; message: string; source: 'check' | 'download' | 'install' };

/** The status the UI reads, plus the shared Settings-row timestamp. */
export type AppUpdateState = AppUpdateStatus & { lastCheckedAt: string | null };

export interface AppUpdate {
  state: AppUpdateState;
  /** The installed version name, or `null` when the build has none. */
  installed: string | null;
  /** True only where the updater runs: a real Android release build. */
  enabled: boolean;
  /** Checks now, ignoring the 6-hour throttle and the snooze. */
  checkNow: () => void;
  /** Downloads the offered version on the user's command (mobile data). */
  download: () => void;
  /** Opens the downloaded APK with the system installer. */
  install: () => void;
  /** Stops an in-flight download. */
  cancel: () => void;
  /** Hides the offered version for 24 hours. */
  later: () => void;
}

function installedVersion(): string | null {
  const version = Constants.expoConfig?.version;
  return typeof version === 'string' && version !== '' ? version : null;
}

function installedVersionCode(): number | null {
  const code = Constants.expoConfig?.android?.versionCode;
  return typeof code === 'number' ? code : null;
}

/** True only for a real Android release build (not dev, not a local build). */
function updateEnabled(): boolean {
  return Platform.OS === 'android' && !__DEV__ && installedVersionCode() !== null;
}

/** True when the auto check is inside its 6-hour throttle window. */
function withinThrottle(lastCheck: string | null): boolean {
  if (lastCheck === null) {
    return false;
  }
  const elapsed = Date.now() - Date.parse(lastCheck);
  return Number.isFinite(elapsed) && elapsed < AUTO_CHECK_INTERVAL_MS;
}

/** True when `snoozed` still hides exactly this version. */
async function isSnoozed(version: string): Promise<boolean> {
  const snoozed = await readSnoozed();
  return snoozed !== null && snoozed.version === version && Date.parse(snoozed.until) > Date.now();
}

// --- The module-level store -------------------------------------------------

let current: AppUpdateState = { status: 'idle', lastCheckedAt: null };
const listeners = new Set<() => void>();

/** The release a download starts from; `available`/`ready` only show its name. */
let latest: LatestRelease | null = null;
/** The cancel hook of the download in flight, if any. */
let cancelDownload: (() => void) | null = null;
/** True while a check or a download runs, so only one of either is in flight. */
let inFlight = false;
/** True once `startAppUpdateChecks` wired the AppState listener and first check. */
let checksStarted = false;

function emit(): void {
  for (const listener of listeners) {
    listener();
  }
}

function setStatus(next: AppUpdateStatus): void {
  current = { ...next, lastCheckedAt: current.lastCheckedAt };
  emit();
}

function setLastCheckedAt(at: string): void {
  current = { ...current, lastCheckedAt: at };
  emit();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getSnapshot(): AppUpdateState {
  return current;
}

// --- The state machine ------------------------------------------------------

/** Removes a cached APK once the installed version has caught up to it. */
async function pruneDownloaded(currentVersion: string | null): Promise<void> {
  if (currentVersion === null) {
    return;
  }
  const downloaded = await readDownloaded();
  if (downloaded !== null && !isNewer(downloaded, currentVersion)) {
    deleteApk();
    await clearDownloaded();
  }
}

async function runDownload(quiet: boolean, fallback: AppUpdateStatus | null = null): Promise<void> {
  const release = latest;
  if (release === null) {
    return;
  }
  setStatus({
    status: 'downloading',
    version: release.version,
    progress: 0,
    quiet,
    sizeBytes: release.sizeBytes,
  });
  const download = downloadApk(release.apkUrl, (progress) => {
    setStatus({
      status: 'downloading',
      version: release.version,
      progress,
      quiet,
      sizeBytes: release.sizeBytes,
    });
  });
  cancelDownload = download.cancel;
  let fileUri: string | null;
  try {
    fileUri = await download.result;
  } catch {
    cancelDownload = null;
    // A quiet download that fails is invisible; restore the state the check
    // replaced, so an offer the user had not dismissed survives the retry.
    setStatus(
      quiet
        ? (fallback ?? { status: 'idle' })
        : { status: 'failed', message: DOWNLOAD_FAILED_MESSAGE, source: 'download' },
    );
    return;
  }
  cancelDownload = null;
  if (fileUri === null) {
    setStatus(
      quiet
        ? (fallback ?? { status: 'idle' })
        : { status: 'available', version: release.version, sizeBytes: release.sizeBytes },
    );
    return;
  }
  await writeDownloaded(release.version);
  setStatus({
    status: 'ready',
    version: release.version,
    sizeBytes: release.sizeBytes,
    fileUri,
  });
}

async function runCheck(auto: boolean): Promise<void> {
  if (!updateEnabled() || inFlight) {
    return;
  }
  inFlight = true;
  // The state to fall back to when an automatic check fails: a background
  // failure must never raise the failure prompt, so it stays silent.
  let previous: AppUpdateStatus = current;
  try {
    const stored = await readLastCheck();
    if (stored !== null) {
      setLastCheckedAt(stored);
    }
    if (auto && withinThrottle(stored)) {
      return;
    }
    previous = current;
    setStatus({ status: 'checking' });
    const release = await checkLatest();
    const at = new Date().toISOString();
    await writeLastCheck(new Date(at));
    setLastCheckedAt(at);
    const installed = installedVersion();
    await pruneDownloaded(installed);
    if (release === null || installed === null || !isNewer(release.version, installed)) {
      latest = null;
      setStatus({ status: 'upToDate' });
      return;
    }
    if (auto && (await isSnoozed(release.version))) {
      latest = release;
      setStatus({ status: 'idle' });
      return;
    }
    latest = release;
    // A version we already downloaded goes straight to "ready".
    const downloaded = await readDownloaded();
    if (downloaded === release.version && apkFileExists()) {
      setStatus({
        status: 'ready',
        version: release.version,
        sizeBytes: release.sizeBytes,
        fileUri: apkFileUri(),
      });
      return;
    }
    // Wi-Fi/Ethernet: download quietly; anything else asks first. A quiet
    // download that fails restores the pre-check state passed as the fallback.
    if (await isUnmeteredConnection()) {
      await runDownload(true, previous);
      return;
    }
    setStatus({ status: 'available', version: release.version, sizeBytes: release.sizeBytes });
  } catch {
    // An automatic check that fails goes back to where it was, keeping
    // `lastCheckedAt`; only a check the user asked for reports a failure.
    setStatus(
      auto ? previous : { status: 'failed', message: CHECK_FAILED_MESSAGE, source: 'check' },
    );
  } finally {
    inFlight = false;
  }
}

// --- The actions the UI calls -----------------------------------------------

function checkNow(): void {
  void runCheck(false);
}

function download(): void {
  if (inFlight || current.status !== 'available') {
    return;
  }
  inFlight = true;
  void runDownload(false).finally(() => {
    inFlight = false;
  });
}

function install(): void {
  if (current.status !== 'ready') {
    return;
  }
  const { version, sizeBytes, fileUri } = current;
  setStatus({ status: 'installing', version, sizeBytes });
  void installApk(fileUri).then(
    () => setStatus({ status: 'ready', version, sizeBytes, fileUri }),
    () => setStatus({ status: 'failed', message: INSTALL_FAILED_MESSAGE, source: 'install' }),
  );
}

function cancel(): void {
  cancelDownload?.();
}

function later(): void {
  if (current.status !== 'available' && current.status !== 'ready') {
    return;
  }
  const version = current.version;
  void writeSnoozed({ version, until: new Date(Date.now() + SNOOZE_MS).toISOString() });
  setStatus({ status: 'idle' });
}

/**
 * Wires the updater to the app: one auto check now and one whenever the app
 * returns to the foreground. The root layout calls this once; further calls do
 * nothing, and it does nothing at all outside a real Android release build.
 */
export function startAppUpdateChecks(): void {
  if (checksStarted) {
    return;
  }
  checksStarted = true;
  if (!updateEnabled()) {
    return;
  }
  // The first check is deferred a microtask, so the store notifies its
  // subscribers in a callback rather than inside a component's render.
  void Promise.resolve().then(() => runCheck(true));
  AppState.addEventListener('change', (next) => {
    if (next === 'active') {
      void runCheck(true);
    }
  });
}

/** The one updater state the root dialog and the Settings row both read. */
export function useAppUpdate(): AppUpdate {
  const state = useSyncExternalStore(subscribe, getSnapshot);
  return {
    state,
    installed: installedVersion(),
    enabled: updateEnabled(),
    checkNow,
    download,
    install,
    cancel,
    later,
  };
}
