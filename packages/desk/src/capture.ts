import { Effect } from 'effect';
import { closeSync, openSync, readSync } from 'node:fs';
import type { StreamName } from './protocol';

export interface OutputCapture {
  push(stream: StreamName, chunk: Buffer): boolean;
  finish(): { readonly stdout: string; readonly stderr: string; readonly truncated: boolean };
}

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
 * Reads at most `maxBytes`: a file grown after a caller's `stat` check would
 * otherwise load unbounded bytes. `tooLarge` lets the caller refuse it.
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
