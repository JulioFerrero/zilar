import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import process from 'node:process';

import {
  evaluateWatch,
  isFirstRenderLine,
  isBundleLoadedLine,
  logLineTimestampMs,
} from './log-watch.ts';
import { BootCheckError, delay, mobileRoot, runCapture, say } from './boot-check-proc.mjs';

const METRO_READY_TIMEOUT_MS = 60_000;
const APP_LOG_WINDOW_SECONDS = 10;
const APP_LOG_POLL_MS = 3_000;

// --- Launch and watch -------------------------------------------------------

export function isPidAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === 'EPERM';
  }
}

export function assertPortFree(port) {
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

export function tryConnect(port) {
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

export async function waitForMetro(port, metro) {
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

export function readAppJson() {
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

export function verifyBakedMetroPort(udid, bundleId, port) {
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

export function launchApp(udid, bundleId) {
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

export function queryAppLog(udid, appName, bundleId, windowSeconds) {
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
export function createLineReader(filePath) {
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

export async function watchBoot({
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

export function isBundledIn(lines) {
  return lines.some((line) => isBundleLoadedLine(line));
}
