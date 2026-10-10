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

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

import {
  assertPortFree,
  isPidAlive,
  launchApp,
  readAppJson,
  verifyBakedMetroPort,
  waitForMetro,
  watchBoot,
} from './boot-check-launch.mjs';
import {
  BootCheckError,
  mobileRoot,
  runCapture,
  runToFile,
  say,
  spawnToLog,
  spawned,
  stopSpawned,
  tailFile,
} from './boot-check-proc.mjs';
import { checkJsDependencies, checkNativeProject, ensureBooted } from './boot-check-steps.mjs';

const DEFAULT_PORT = 8082;
const DEFAULT_TIMEOUT_SECONDS = 90;
const DEFAULT_SETTLE_SECONDS = 5;
const FORBIDDEN_PORT = 8081;

function usage() {
  return `Usage: pnpm --filter @zilar/mobile boot:ios --device <udid> [options]

Build, install and launch the Zilar iOS app on a simulator and fail loudly if
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
