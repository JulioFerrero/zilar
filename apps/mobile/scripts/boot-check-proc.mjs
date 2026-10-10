import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const scriptsDir = path.dirname(fileURLToPath(import.meta.url));
export const mobileRoot = path.resolve(scriptsDir, '..');

/** A failure the user can act on; reported as a one-line reason. */
export class BootCheckError extends Error {}

/** Everything this script started in the background, so SIGINT can stop it. */
export const spawned = [];

export function say(message) {
  console.log(`[boot-check] ${message}`);
}

export function runCapture(command, args, options = {}) {
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
export function runStreamed(command, args, options = {}) {
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
export function runToFile(command, args, { logPath, ...options }) {
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
export function spawnToLog(command, args, { logPath, ...options }) {
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

export async function stopSpawned(entry, label) {
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

export function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function tailFile(filePath, lines) {
  if (!fs.existsSync(filePath)) {
    return '';
  }
  const content = fs.readFileSync(filePath, 'utf8');
  return content.split('\n').filter(Boolean).slice(-lines).join(' / ');
}
