import fs from 'node:fs';
import path from 'node:path';

import { findMissingPods, parseAutolinkingPods } from './pods.ts';
import { BootCheckError, mobileRoot, runCapture, runStreamed, say } from './boot-check-proc.mjs';

// --- Step 1: the native project matches the dependencies -------------------

export function readAutolinkingPods() {
  const result = runCapture(
    'pnpm',
    ['exec', 'expo-modules-autolinking', 'resolve', '--platform', 'ios', '--json'],
    { cwd: mobileRoot },
  );
  if (result.status !== 0) {
    throw new BootCheckError(
      `expo-modules-autolinking failed: ${(result.stderr || result.stdout).trim().slice(-300)}`,
    );
  }
  return parseAutolinkingPods(result.stdout);
}

export function missingNativePods(expectedPods) {
  const lockfile = path.join(mobileRoot, 'ios', 'Podfile.lock');
  const text = fs.existsSync(lockfile) ? fs.readFileSync(lockfile, 'utf8') : '';
  return findMissingPods(expectedPods, text);
}

export async function checkNativeProject() {
  const expected = readAutolinkingPods();
  say(`autolinking expects ${expected.length} iOS pods`);

  if (!fs.existsSync(path.join(mobileRoot, 'ios', 'Podfile'))) {
    say('ios/ does not exist — running expo prebuild to create it');
    await runStreamed('pnpm', ['exec', 'expo', 'prebuild', '--platform', 'ios'], {
      cwd: mobileRoot,
    });
  }

  let missing = missingNativePods(expected);
  if (missing.length > 0) {
    say(`Podfile.lock is missing ${missing.join(', ')} — running pod install`);
    if (!fs.existsSync(path.join(mobileRoot, 'ios', 'Podfile'))) {
      throw new BootCheckError('expo prebuild did not create ios/Podfile');
    }
    await runStreamed('pod', ['install'], { cwd: path.join(mobileRoot, 'ios') });
    missing = missingNativePods(expected);
    if (missing.length > 0) {
      throw new BootCheckError(`Podfile.lock still misses ${missing.join(', ')} after pod install`);
    }
  }
  say('native project matches the autolinked dependencies');
}

// --- Step 2: JS dependencies match the lockfile -----------------------------

export function checkJsDependencies(workspaceRoot) {
  const lockfile = path.join(workspaceRoot, 'pnpm-lock.yaml');
  const installedLockfile = path.join(workspaceRoot, 'node_modules', '.pnpm', 'lock.yaml');
  if (!fs.existsSync(lockfile)) {
    throw new BootCheckError(`no pnpm-lock.yaml at ${lockfile}`);
  }
  // pnpm has no --dry-run for install, so staleness is detected by comparing
  // the lockfile snapshot inside node_modules (written by the last install)
  // with pnpm-lock.yaml, then letting a real frozen offline install verify the
  // rest. Both are cheap when everything is already in place.
  const lockMatches =
    fs.existsSync(installedLockfile) &&
    fs.readFileSync(installedLockfile, 'utf8') === fs.readFileSync(lockfile, 'utf8');
  if (!lockMatches) {
    throw new BootCheckError(
      'node_modules is stale (it does not match pnpm-lock.yaml) — run `pnpm install` first',
    );
  }
  const result = runCapture('pnpm', ['install', '--frozen-lockfile', '--offline'], {
    cwd: workspaceRoot,
  });
  if (result.status !== 0) {
    const detail = `${result.stdout}\n${result.stderr}`.trim().split('\n').slice(-3).join(' / ');
    throw new BootCheckError(`pnpm install --frozen-lockfile --offline failed: ${detail}`);
  }
  say('JS dependencies match the lockfile');
}

// --- Simulator helpers ------------------------------------------------------

export function findSimulator(udid) {
  const result = runCapture('xcrun', ['simctl', 'list', 'devices', '--json']);
  if (result.status !== 0) {
    throw new BootCheckError(`simctl list devices failed: ${result.stderr.trim()}`);
  }
  let parsed;
  try {
    parsed = JSON.parse(result.stdout);
  } catch {
    throw new BootCheckError('simctl list devices printed invalid JSON');
  }
  const runtimes = parsed && typeof parsed === 'object' ? parsed.devices : null;
  if (!runtimes || typeof runtimes !== 'object') {
    throw new BootCheckError('unexpected simctl list devices shape (no "devices")');
  }
  for (const devices of Object.values(runtimes)) {
    if (!Array.isArray(devices)) {
      continue;
    }
    for (const device of devices) {
      if (device && device.udid === udid) {
        return device;
      }
    }
  }
  throw new BootCheckError(`simulator ${udid} was not found`);
}

export async function ensureBooted(udid) {
  const device = findSimulator(udid);
  if (device.state === 'Booted') {
    return device;
  }
  say(`booting simulator "${device.name}" (${udid})`);
  const boot = runCapture('xcrun', ['simctl', 'boot', udid]);
  if (boot.status !== 0 && findSimulator(udid).state !== 'Booted') {
    throw new BootCheckError(`simctl boot failed: ${boot.stderr.trim()}`);
  }
  const status = runCapture('xcrun', ['simctl', 'bootstatus', udid, '-b']);
  if (status.status !== 0) {
    throw new BootCheckError(`simulator did not finish booting: ${status.stderr.trim()}`);
  }
  return findSimulator(udid);
}
