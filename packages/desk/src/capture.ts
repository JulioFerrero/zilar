import { Effect } from 'effect';
import { closeSync, openSync, readSync } from 'node:fs';
import type { StreamName } from './protocol';

/** A cap on the bytes a single request may return, split by stream. */
export interface OutputCapture {
  /** Returns true once the cap is reached; the caller then stops the process. */
  push(stream: StreamName, chunk: Buffer): boolean;
  finish(): { readonly stdout: string; readonly stderr: string; readonly truncated: boolean };
}

/** Collects at most `maxBytes` across stdout and stderr, in arrival order. */
export function createCapture(maxBytes: number): OutputCapture {
  let remaining = maxBytes;
  let truncated = false;
  const stdout: Buffer[] = [];
  const stderr: Buffer[] = [];

  const push = (stream: StreamName, chunk: Buffer): boolean => {
    const sink = stream === 'stdout' ? stdout : stderr;
    if (remaining <= 0) {
      truncated = true;
      return true;
    }
    if (chunk.byteLength > remaining) {
      sink.push(chunk.subarray(0, remaining));
      remaining = 0;
      truncated = true;
      return true;
    }
    sink.push(chunk);
    remaining -= chunk.byteLength;
    return false;
  };

  return {
    push,
    finish: () => ({
      stdout: Buffer.concat(stdout).toString('utf8'),
      stderr: Buffer.concat(stderr).toString('utf8'),
      truncated,
    }),
  };
}

/**
 * Reads a file but never more than `maxBytes`: a plain `readFileSync` loads the
 * whole file, and a file grown after a caller's `stat` check (or `edit`, which
 * has no check) would load unbounded bytes into the daemon. `tooLarge` is set
 * when the file has more than `maxBytes`, so the caller can refuse it instead.
 * The `fs` calls are I/O, so they are wrapped in an Effect run sync here.
 */
type FsFailure = { readonly code?: string };

function readCappedFileEffect(
  absolute: string,
  maxBytes: number,
): Effect.Effect<{ readonly text: string; readonly tooLarge: boolean }, FsFailure> {
  return Effect.try({
    try: () => {
      const descriptor = openSync(absolute, 'r');
      try {
        const buffer = Buffer.allocUnsafe(maxBytes + 1);
        let total = 0;
        while (total < buffer.byteLength) {
          const read = readSync(descriptor, buffer, total, buffer.byteLength - total, total);
          if (read === 0) {
            break;
          }
          total += read;
        }
        return { text: buffer.subarray(0, total).toString('utf8'), tooLarge: total > maxBytes };
      } finally {
        closeSync(descriptor);
      }
    },
    catch: (error) => error as FsFailure,
  });
}

export function readCappedFile(
  absolute: string,
  maxBytes: number,
): { readonly text: string; readonly tooLarge: boolean } {
  return Effect.runSync(readCappedFileEffect(absolute, maxBytes));
}
