// effect-plain: the updater store is plain module state over the app-update-native promise seam; the download cancel function has no Effect shape
/**
 * Only one check or download runs at a time, however many components read this module-level state. On a check it downloads quietly on Wi-Fi/Ethernet or asks first on mobile data.
 *
 * Deliberately off unless the build is a real Android release: dev and local builds have no `versionCode` and must never fetch or prompt.
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

const AUTO_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;

const SNOOZE_MS = 24 * 60 * 60 * 1000;

/** Fixed user-facing messages; a raw error never reaches the UI. */
const CHECK_FAILED_MESSAGE = 'Could not check for updates.';
const DOWNLOAD_FAILED_MESSAGE = 'The update could not be downloaded.';
const INSTALL_FAILED_MESSAGE = 'The update could not be opened.';

export type AppUpdateStatus =
  | { status: 'idle' }
  | { status: 'checking' }
  | { status: 'upToDate' }
  | { status: 'available'; version: string; sizeBytes: number }
  | { status: 'ready'; version: string; sizeBytes: number; fileUri: string }
  | { status: 'downloading'; version: string; progress: number; quiet: boolean; sizeBytes: number }
  | { status: 'installing'; version: string; sizeBytes: number }
  | { status: 'failed'; message: string; source: 'check' | 'download' | 'install' };

export type AppUpdateState = AppUpdateStatus & { lastCheckedAt: string | null };

export interface AppUpdate {
  state: AppUpdateState;
  installed: string | null;
  enabled: boolean;
  checkNow: () => void;
  download: () => void;
  install: () => void;
  cancel: () => void;
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

function updateEnabled(): boolean {
  return Platform.OS === 'android' && !__DEV__ && installedVersionCode() !== null;
}

function withinThrottle(lastCheck: string | null): boolean {
  if (lastCheck === null) {
    return false;
  }
  const elapsed = Date.now() - Date.parse(lastCheck);
  return Number.isFinite(elapsed) && elapsed < AUTO_CHECK_INTERVAL_MS;
}

async function isSnoozed(version: string): Promise<boolean> {
  const snoozed = await readSnoozed();
  return snoozed !== null && snoozed.version === version && Date.parse(snoozed.until) > Date.now();
}

let current: AppUpdateState = { status: 'idle', lastCheckedAt: null };
const listeners = new Set<() => void>();

let latest: LatestRelease | null = null;
let cancelDownload: (() => void) | null = null;
let inFlight = false;
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
  // A background failure must never raise the failure prompt.
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
    // Wi-Fi/Ethernet downloads quietly; anything else asks first.
    if (await isUnmeteredConnection()) {
      await runDownload(true, previous);
      return;
    }
    setStatus({ status: 'available', version: release.version, sizeBytes: release.sizeBytes });
  } catch {
    // Only a check the user asked for reports a failure.
    setStatus(
      auto ? previous : { status: 'failed', message: CHECK_FAILED_MESSAGE, source: 'check' },
    );
  } finally {
    inFlight = false;
  }
}

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
 * Further calls do nothing, and it does nothing at all outside a real Android release build.
 */
export function startAppUpdateChecks(): void {
  if (checksStarted) {
    return;
  }
  checksStarted = true;
  if (!updateEnabled()) {
    return;
  }
  // Deferred a microtask, so the store notifies in a callback rather than inside a render.
  void Promise.resolve().then(() => runCheck(true));
  AppState.addEventListener('change', (next) => {
    if (next === 'active') {
      void runCheck(true);
    }
  });
}

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
