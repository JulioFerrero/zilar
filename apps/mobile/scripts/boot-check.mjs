#!/usr/bin/env node
// T-0031 boot check: one command that proves the iOS app actually starts.
//
// It (1) compares the iOS pods Expo autolinking expects with ios/Podfile.lock
// and repairs the native project when they differ, (2) verifies the JS
// dependencies match the lockfile, (3) starts Metro on its own port, builds and
// installs with `expo run:ios --no-bundler`, (4) launches the app on a
// simulator and watches the Metro log plus the simulator's app log for errors,
// and (5) always saves a screenshot and both logs, stops the processes it
// started, and exits non-zero with a one-line reason on failure.

import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import {
  evaluateWatch,
  isFirstRenderLine,
  isBundleLoadedLine,
  logLineTimestampMs,
} from './log-watch.ts';
import { findMissingPods, parseAutolinkingPods } from './pods.ts';

const scriptsDir = path.dirname(fileURLToPath(import.meta.url));
const mobileRoot = path.resolve(scriptsDir, '..');

const DEFAULT_PORT = 8082;
const DEFAULT_TIMEOUT_SECONDS = 90;
const DEFAULT_SETTLE_SECONDS = 5;
const FORBIDDEN_PORT = 8081;
const METRO_READY_TIMEOUT_MS = 60_000;
const APP_LOG_WINDOW_SECONDS = 10;
const APP_LOG_POLL_MS = 3_000;

/** A failure the user can act on; reported as a one-line reason. */
class BootCheckError extends Error {}

/** Everything this script started in the background, so SIGINT can stop it. */
const spawned = [];

function say(message) {
  console.log(`[boot-check] ${message}`);
}

function usage() {
  return `Usage: pnpm --filter @galena/mobile boot:ios --device <udid> [options]

Build, install and launch the Galena iOS app on a simulator and fail loudly if
it does not come up.

Options:
  --device <udid>    Simulator UDID to boot, install and launch on (required).
  --port <n>         Metro port (default ${DEFAULT_PORT}; 8081 is refused).
  --timeout <s>      Seconds to wait for the bundle (default ${DEFAULT_TIMEOUT_SECONDS}).
  --settle <s>       Seconds to watch after the bundle loaded (default ${DEFAULT_SETTLE_SECONDS}).
  -h, --help         Show this help.`;
}

function parseArgs(argv) {
  const options = {
    device: null,
    port: DEFAULT_PORT,
    timeoutMs: DEFAULT_TIMEOUT_SECONDS * 1000,
    settleMs: DEFAULT_SETTLE_SECONDS * 1000,
    help: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '-h' || arg === '--help') {
      options.help = true;
    } else if (
      arg === '--device' ||
      arg === '--port' ||
      arg === '--timeout' ||
      arg === '--settle'
    ) {
      const value = argv[i + 1];
      if (value === undefined || value.startsWith('--')) {
        throw new BootCheckError(`${arg} needs a value`);
      }
      i += 1;
      if (arg === '--device') {
        options.device = value;
      } else if (arg === '--port') {
        options.port = Number(value);
        if (!Number.isInteger(options.port) || options.port < 1 || options.port > 65_535) {
          throw new BootCheckError(`--port must be a port number, got "${value}"`);
        }
      } else if (arg === '--timeout') {
        options.timeoutMs = parseSeconds(arg, value);
      } else {
        options.settleMs = parseSeconds(arg, value);
      }
    } else {
      throw new BootCheckError(`unknown argument "${arg}"`);
    }
  }
  if (options.help) {
    return options;
  }
  if (!options.device) {
    throw new BootCheckError('--device <udid> is required (never guess a simulator)');
  }
  if (options.port === FORBIDDEN_PORT) {
    throw new BootCheckError(`port ${FORBIDDEN_PORT} is never used by this check, pick another`);
  }
  return options;
}

function parseSeconds(flag, value) {
  const seconds = Number(value);
  if (!Number.isFinite(seconds) || seconds < 0) {
    throw new BootCheckError(`${flag} must be a number of seconds, got "${value}"`);
  }
  return seconds * 1000;
}

function findWorkspaceRoot(startDir) {
  let dir = startDir;
  for (;;) {
    if (fs.existsSync(path.join(dir, 'pnpm-lock.yaml'))) {
      return dir;
    }
    const parent = path.dirname(dir);
    if (parent === dir) {
      throw new BootCheckError('could not find the workspace root (pnpm-lock.yaml)');
    }
    dir = parent;
  }
}

function runCapture(command, args, options = {}) {
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    ...options,
  });
  if (result.error) {
    throw new BootCheckError(`cannot run ${command}: ${result.error.message}`);
  }
  return result;
}

/** Run a long command with its output streaming to the console. */
function runStreamed(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: 'inherit', ...options });
    child.on('error', (error) =>
      reject(new BootCheckError(`cannot run ${command}: ${error.message}`)),
    );
    child.on('exit', (code, signal) => {
      if (code === 0) {
        resolve();
      } else {
        reject(
          new BootCheckError(`${command} ${args.join(' ')} failed (${signal ?? `exit ${code}`})`),
        );
      }
    });
  });
}

/** Run a command, streaming everything into a log file; returns the exit code. */
function runToFile(command, args, { logPath, ...options }) {
  return new Promise((resolve, reject) => {
    const logStream = fs.createWriteStream(logPath, { flags: 'a' });
    logStream.write(`$ ${command} ${args.join(' ')}\n`);
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'], ...options });
    child.stdout.pipe(logStream, { end: false });
    child.stderr.pipe(logStream, { end: false });
    child.on('error', (error) => {
      logStream.end();
      reject(new BootCheckError(`cannot run ${command}: ${error.message}`));
    });
    child.on('exit', (code, signal) => {
      logStream.end(() => resolve(signal ? 1 : (code ?? 1)));
    });
  });
}

/**
 * Start a background command whose combined output goes to a log file. The
 * process runs in its own process group so cleanup can stop exactly the tree
 * this script started — never `kill` by name or port.
 */
function spawnToLog(command, args, { logPath, ...options }) {
  const logStream = fs.createWriteStream(logPath, { flags: 'a' });
  const child = spawn(command, args, {
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: true,
    ...options,
  });
  child.stdout.pipe(logStream, { end: false });
  child.stderr.pipe(logStream, { end: false });
  let exited = false;
  child.on('exit', () => {
    exited = true;
    logStream.end();
  });
  const entry = {
    child,
    logPath,
    isRunning: () => !exited && child.exitCode === null,
    signal: (sig) => {
      if (child.pid === undefined || exited) {
        return;
      }
      try {
        process.kill(-child.pid, sig);
      } catch {
        // Already gone, or the group leader exited first.
      }
    },
  };
  spawned.push(entry);
  return entry;
}

async function stopSpawned(entry, label) {
  if (!entry || !entry.isRunning()) {
    return;
  }
  say(`stopping ${label}`);
  entry.signal('SIGTERM');
  for (let i = 0; i < 30 && entry.isRunning(); i += 1) {
    await delay(100);
  }
  if (entry.isRunning()) {
    entry.signal('SIGKILL');
    for (let i = 0; i < 20 && entry.isRunning(); i += 1) {
      await delay(100);
    }
  }
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function tailFile(filePath, lines) {
  if (!fs.existsSync(filePath)) {
    return '';
  }
  const content = fs.readFileSync(filePath, 'utf8');
  return content.split('\n').filter(Boolean).slice(-lines).join(' / ');
}

// --- Step 1: the native project matches the dependencies -------------------

function readAutolinkingPods() {
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

function missingNativePods(expectedPods) {
  const lockfile = path.join(mobileRoot, 'ios', 'Podfile.lock');
  const text = fs.existsSync(lockfile) ? fs.readFileSync(lockfile, 'utf8') : '';
  return findMissingPods(expectedPods, text);
}

async function checkNativeProject() {
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

function checkJsDependencies(workspaceRoot) {
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

function findSimulator(udid) {
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

async function ensureBooted(udid) {
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

// --- Launch and watch -------------------------------------------------------

function isPidAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === 'EPERM';
  }
}

function assertPortFree(port) {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', (error) => {
      reject(
        new BootCheckError(
          `port ${port} is already in use (${error.code}) — the boot check never stops a process it did not start`,
        ),
      );
    });
    server.listen(port, () => server.close(() => resolve()));
  });
}

function tryConnect(port) {
  // Metro may bind either loopback family, so probe both.
  return new Promise((resolve) => {
    let pending = 2;
    let connected = false;
    for (const host of ['127.0.0.1', '::1']) {
      const socket = net.connect({ port, host });
      const finish = (ok) => {
        socket.destroy();
        connected = connected || ok;
        pending -= 1;
        if (pending === 0) {
          resolve(connected);
        }
      };
      socket.once('connect', () => finish(true));
      socket.once('error', () => finish(false));
      socket.setTimeout(1000, () => finish(false));
    }
  });
}

async function waitForMetro(port, metro) {
  const deadline = Date.now() + METRO_READY_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (!metro.isRunning()) {
      throw new BootCheckError(
        `Metro exited before it listened on port ${port} — see ${metro.logPath}`,
      );
    }
    if (await tryConnect(port)) {
      return;
    }
    await delay(250);
  }
  throw new BootCheckError(
    `Metro did not listen on port ${port} within ${METRO_READY_TIMEOUT_MS / 1000}s`,
  );
}

function readAppJson() {
  const appJsonPath = path.join(mobileRoot, 'app.json');
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(appJsonPath, 'utf8'));
  } catch (error) {
    throw new BootCheckError(`cannot read app.json: ${error.message}`);
  }
  const expo = parsed && typeof parsed === 'object' ? parsed.expo : null;
  const bundleId = expo && typeof expo.ios === 'object' ? expo.ios.bundleIdentifier : null;
  if (!expo || typeof expo.name !== 'string' || typeof bundleId !== 'string') {
    throw new BootCheckError('app.json does not contain expo.name and expo.ios.bundleIdentifier');
  }
  return { appName: expo.name, bundleId };
}

function verifyBakedMetroPort(udid, bundleId, port) {
  const container = runCapture('xcrun', ['simctl', 'get_app_container', udid, bundleId, 'app']);
  if (container.status !== 0) {
    throw new BootCheckError(`the app is not installed on ${udid}: ${container.stderr.trim()}`);
  }
  const plist = path.join(container.stdout.trim(), 'Info.plist');
  const extracted = runCapture('plutil', ['-extract', 'RCTMetroPort', 'raw', '-o', '-', plist]);
  if (extracted.status !== 0) {
    throw new BootCheckError(
      'the installed app has no RCTMetroPort in Info.plist; it would fall back to port 8081, so it is not launched',
    );
  }
  const baked = extracted.stdout.trim();
  if (baked !== String(port)) {
    throw new BootCheckError(
      `the app was built for Metro port ${baked || '(empty)'} but this check uses ${port}; it is not launched`,
    );
  }
  say(`installed app points at Metro port ${baked}`);
}

function launchApp(udid, bundleId) {
  // run:ios launches the app once itself; terminate that copy so the watch
  // window starts at a clean, known launch.
  runCapture('xcrun', ['simctl', 'terminate', udid, bundleId]);
  const launchedAt = Date.now();
  const result = runCapture('xcrun', ['simctl', 'launch', udid, bundleId]);
  if (result.status !== 0) {
    throw new BootCheckError(`simctl launch failed: ${result.stderr.trim()}`);
  }
  const match = /(\d+)\s*$/.exec(result.stdout.trim());
  if (!match) {
    throw new BootCheckError(`unexpected simctl launch output: "${result.stdout.trim()}"`);
  }
  return { pid: Number(match[1]), launchedAt };
}

function queryAppLog(udid, appName, bundleId, windowSeconds) {
  const predicate = `process == "${appName}" OR eventMessage CONTAINS[c] "${bundleId}" OR subsystem == "com.facebook.react.log"`;
  const result = runCapture(
    'xcrun',
    [
      'simctl',
      'spawn',
      udid,
      'log',
      'show',
      '--last',
      `${windowSeconds}s`,
      '--style',
      'compact',
      '--info',
      '--predicate',
      predicate,
    ],
    { timeout: 30_000 },
  );
  if (result.status !== 0) {
    return `log show failed: ${result.stderr.trim().slice(-300)}`;
  }
  return result.stdout;
}

/** Reads only the bytes appended since the reader was created. */
function createLineReader(filePath) {
  let offset = fs.existsSync(filePath) ? fs.statSync(filePath).size : 0;
  let pending = '';
  return {
    /** Restart at the current end of file (used right before launching). */
    skipToTail() {
      offset = fs.existsSync(filePath) ? fs.statSync(filePath).size : 0;
      pending = '';
    },
    readLines() {
      if (!fs.existsSync(filePath)) {
        return [];
      }
      const { size } = fs.statSync(filePath);
      if (size < offset) {
        offset = 0;
      }
      if (size === offset) {
        return [];
      }
      const buffer = Buffer.alloc(size - offset);
      const fd = fs.openSync(filePath, 'r');
      try {
        fs.readSync(fd, buffer, 0, buffer.length, offset);
      } finally {
        fs.closeSync(fd);
      }
      offset = size;
      pending += buffer.toString('utf8');
      const lines = pending.split('\n');
      pending = lines.pop() ?? '';
      return lines;
    },
  };
}

async function watchBoot({
  metroLogPath,
  appLogPath,
  metro,
  udid,
  appName,
  bundleId,
  pid,
  launchedAt,
  timeoutMs,
  settleMs,
}) {
  const metroReader = createLineReader(metroLogPath);
  const appReader = createLineReader(appLogPath);
  metroReader.skipToTail();
  appReader.skipToTail();

  const deadline = Date.now() + timeoutMs;
  let bundledAt = null;
  let renderedAt = null;
  let nextAppQueryAt = 0;

  const fail = (reason) => ({ ok: false, reason });
  // Only lines written by this launch count: the first `log show` query also
  // reaches back into the copy run:ios launched before it terminated it.
  const appLinesOfThisLaunch = (lines) =>
    lines.filter((line) => {
      const timestamp = logLineTimestampMs(line);
      return timestamp === null || timestamp >= launchedAt;
    });
  const queryAppLogNow = () => {
    fs.appendFileSync(appLogPath, queryAppLog(udid, appName, bundleId, APP_LOG_WINDOW_SECONDS));
  };

  for (;;) {
    const metroLines = metroReader.readLines();
    const appLines = appLinesOfThisLaunch(appReader.readLines());
    const verdict = evaluateWatch({
      metroLog: metroLines.join('\n'),
      appLog: appLines.join('\n'),
      appExited: !isPidAlive(pid),
    });
    if (verdict.status === 'failed') {
      return fail(verdict.reason);
    }
    const now = Date.now();
    if (bundledAt === null && isBundledIn(metroLines)) {
      bundledAt = now;
    }
    for (const line of appLines) {
      if (renderedAt === null && isFirstRenderLine(line)) {
        renderedAt = now;
      }
    }
    if (!metro.isRunning()) {
      return fail('the Metro process this check started exited');
    }

    if (now >= nextAppQueryAt) {
      nextAppQueryAt = now + APP_LOG_POLL_MS;
      queryAppLogNow();
      const lateLines = appLinesOfThisLaunch(appReader.readLines());
      const lateFailure = evaluateWatch({ metroLog: '', appLog: lateLines.join('\n') });
      if (lateFailure.status === 'failed') {
        return fail(lateFailure.reason);
      }
      for (const line of lateLines) {
        if (renderedAt === null && isFirstRenderLine(line)) {
          renderedAt = now;
        }
      }
    }

    const readyAt =
      bundledAt !== null && renderedAt !== null ? Math.max(bundledAt, renderedAt) : null;
    if (readyAt === null) {
      if (now >= deadline) {
        const seconds = Math.round(timeoutMs / 1000);
        if (bundledAt === null) {
          return fail(`no bundle within ${seconds}s (no "Bundled" line in the Metro log)`);
        }
        return fail(
          `bundle loaded but no evidence the JS app ran within ${seconds}s (no "Running ..." line in the app log)`,
        );
      }
    } else if (now - readyAt >= settleMs) {
      // One last look at the app log so errors in the final settle seconds are
      // not missed by the polling cadence.
      queryAppLogNow();
      const finalLines = appLinesOfThisLaunch(appReader.readLines());
      const finalCheck = evaluateWatch({
        metroLog: '',
        appLog: finalLines.join('\n'),
        appExited: !isPidAlive(pid),
      });
      if (finalCheck.status === 'failed') {
        return fail(finalCheck.reason);
      }
      return { ok: true, reason: null };
    }
    await delay(500);
  }
}

function isBundledIn(lines) {
  return lines.some((line) => isBundleLoadedLine(line));
}

async function main() {
  let options;
  try {
    options = parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error(`[boot-check] FAIL: ${error.message}\n`);
    console.error(usage());
    return 2;
  }
  if (options.help) {
    console.log(usage());
    return 0;
  }

  const workspaceRoot = findWorkspaceRoot(mobileRoot);
  const { appName, bundleId } = readAppJson();
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const artifactsDir = path.join(mobileRoot, '.expo', 'boot-check', stamp);
  fs.mkdirSync(artifactsDir, { recursive: true });
  const metroLogPath = path.join(artifactsDir, 'metro.log');
  const appLogPath = path.join(artifactsDir, 'app.log');
  const buildLogPath = path.join(artifactsDir, 'build.log');
  fs.writeFileSync(appLogPath, '');
  say(`artifacts: ${artifactsDir}`);
  say(`device: ${options.device} | metro port: ${options.port}`);

  let metro = null;
  let device = null;
  let outcome = { ok: false, reason: 'the boot check did not run' };
  let screenshotPath = null;

  try {
    await checkNativeProject();
    checkJsDependencies(workspaceRoot);

    device = await ensureBooted(options.device);

    await assertPortFree(options.port);
    metro = spawnToLog('pnpm', ['exec', 'expo', 'start', '--port', String(options.port)], {
      cwd: mobileRoot,
      env: { ...process.env, RCT_METRO_PORT: String(options.port) },
      logPath: metroLogPath,
    });
    say(`starting Metro on port ${options.port} (log: ${metroLogPath})`);
    await waitForMetro(options.port, metro);

    say('building and installing with expo run:ios --no-bundler (this can take a while)');
    const buildCode = await runToFile(
      'pnpm',
      ['exec', 'expo', 'run:ios', '--no-bundler', '--device', options.device],
      {
        cwd: mobileRoot,
        env: { ...process.env, RCT_METRO_PORT: String(options.port) },
        logPath: buildLogPath,
      },
    );
    if (buildCode !== 0) {
      throw new BootCheckError(
        `expo run:ios failed (exit ${buildCode}) — see ${buildLogPath}: ${tailFile(buildLogPath, 3)}`,
      );
    }
    say('build and install finished');

    verifyBakedMetroPort(options.device, bundleId, options.port);

    const { pid, launchedAt } = launchApp(options.device, bundleId);
    say(`launched ${bundleId} (pid ${pid})`);
    if (!isPidAlive(pid)) {
      throw new BootCheckError('the app process exited immediately after launch');
    }

    outcome = await watchBoot({
      metroLogPath,
      appLogPath,
      metro,
      udid: options.device,
      appName,
      bundleId,
      pid,
      launchedAt,
      timeoutMs: options.timeoutMs,
      settleMs: options.settleMs,
    });
  } catch (error) {
    outcome = {
      ok: false,
      reason: error instanceof BootCheckError ? error.message : `${error}`,
    };
  }

  // Cleanup and report, on success and on failure alike.
  if (device) {
    const shot = runCapture('xcrun', [
      'simctl',
      'io',
      options.device,
      'screenshot',
      path.join(artifactsDir, 'screenshot.png'),
    ]);
    screenshotPath = shot.status === 0 ? path.join(artifactsDir, 'screenshot.png') : null;
    if (!screenshotPath) {
      say(`screenshot failed: ${shot.stderr.trim()}`);
    }
  }
  await stopSpawned(metro, 'the Metro process it started');
  say(`artifacts: ${artifactsDir}`);
  if (screenshotPath) {
    say(`screenshot: ${screenshotPath}`);
  }
  say(`metro log: ${metroLogPath}`);
  say(`app log:   ${appLogPath}`);
  if (outcome.ok) {
    say(
      `PASS: bundle loaded and the JS app ran, no errors for ${Math.round(options.settleMs / 1000)}s of settle time`,
    );
    return 0;
  }
  console.log(`[boot-check] FAIL: ${outcome.reason}`);
  return 1;
}

process.on('SIGINT', () => {
  // Write synchronously: stderr may be a pipe and process.exit() would drop it.
  fs.writeSync(2, '\n[boot-check] FAIL: interrupted\n');
  process.exitCode = 130;
  for (const entry of spawned) {
    entry.signal('SIGTERM');
  }
  setTimeout(() => process.exit(130), 3000).unref();
});

main().then(
  (code) => {
    // Set the code instead of exiting: lets stdout/stderr flush when piped.
    process.exitCode = code;
  },
  (error) => {
    console.error(`[boot-check] FAIL: ${error}`);
    process.exitCode = 1;
  },
);
