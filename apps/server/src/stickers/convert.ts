// T-1496: turns a moving upload (GIF, WebM, MP4/MOV) into an animated WebP
// sticker that loops, so stickers keep their motion. The conversion runs
// ffmpeg/ffprobe with no shell and a hard timeout (via `media/run-command`).

import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Effect, Schema } from 'effect';
import { HttpError } from '../errors';
import { FfmpegError, runCommand, type CommandResult } from '../media/run-command';
import { STICKER_MAX_BYTES } from './image';

const FFPROBE_TIMEOUT_MS = 10_000;
const FFMPEG_TIMEOUT_MS = 20_000;

/** A video longer than this answers `sticker_too_long`; the small slack over
 *  the 3 s `-t` cap absorbs container rounding. */
const MAX_DURATION_SECONDS = 3.05;
const OUTPUT_DURATION_SECONDS = 3;

/** Quality levels tried in order; the first output of at most 512 KiB wins. */
const QUALITY_LEVELS = [75, 60, 45, 30] as const;

const MAX_CONCURRENT_CONVERSIONS = 2;

export type ConvertibleKind = 'gif' | 'webm' | 'mp4';

/**
 * The moving kinds the converter accepts, decided by magic bytes only:
 * `GIF87a`/`GIF89a` is a GIF, EBML (`1A 45 DF A3`) is WebM/Matroska, and
 * `ftyp` at offset 4 is MP4/MOV. Anything else is static (or unsupported).
 */
export function convertibleKind(bytes: Uint8Array): ConvertibleKind | null {
  if (bytes.length >= 6) {
    const header = String.fromCharCode(
      bytes[0]!,
      bytes[1]!,
      bytes[2]!,
      bytes[3]!,
      bytes[4]!,
      bytes[5]!,
    );
    if (header === 'GIF87a' || header === 'GIF89a') {
      return 'gif';
    }
  }
  if (
    bytes.length >= 4 &&
    bytes[0] === 0x1a &&
    bytes[1] === 0x45 &&
    bytes[2] === 0xdf &&
    bytes[3] === 0xa3
  ) {
    return 'webm';
  }
  if (
    bytes.length >= 8 &&
    bytes[4] === 0x66 &&
    bytes[5] === 0x74 &&
    bytes[6] === 0x79 &&
    bytes[7] === 0x70
  ) {
    return 'mp4';
  }
  return null;
}

export interface StickerConverter {
  /** Converts a moving upload to an animated WebP, or throws an `HttpError`. */
  toAnimatedWebp(bytes: Uint8Array, kind: ConvertibleKind): Promise<Uint8Array>;
}

/** Reports a conversion failure with a short summary and the stderr tail. */
export type StickerConvertWarn = (summary: string, stderrTail: string) => void;

export interface StickerConverterPaths {
  ffmpeg?: string;
  ffprobe?: string;
  /** Called on a conversion failure; defaults to a console log line. */
  warn?: StickerConvertWarn;
}

const FfprobeJson = Schema.fromJsonString(
  Schema.Struct({
    format: Schema.optional(
      Schema.Struct({
        duration: Schema.optional(Schema.String),
      }),
    ),
    streams: Schema.optional(
      Schema.Array(
        Schema.Struct({
          codec_type: Schema.optional(Schema.String),
          codec_name: Schema.optional(Schema.String),
          duration: Schema.optional(Schema.String),
        }),
      ),
    ),
  }),
);

type FfprobeOutput = typeof FfprobeJson.Type;

interface ProbedVideo {
  codecName?: string;
}

function convertFailed(): HttpError {
  return new HttpError(
    400,
    'sticker_convert_failed',
    'This file could not be turned into a sticker',
  );
}

/** Logs the exit code (when there is one) and the tail of stderr, never the
 *  file's bytes. Uses the injected `warn` when present, else the console. */
function logConvertFailure(
  warn: StickerConvertWarn | undefined,
  summary: string,
  stderr: string,
): void {
  const tail = stderr.slice(-300);
  if (warn !== undefined) {
    warn(summary, tail);
    return;
  }
  console.warn(`[stickers] ${summary}${tail === '' ? '' : `: ${tail}`}`);
}

function parseDurationSeconds(raw: string | undefined): number | undefined {
  if (raw === undefined) return undefined;
  const seconds = Number.parseFloat(raw);
  return Number.isFinite(seconds) && seconds > 0 ? seconds : undefined;
}

// A fair semaphore: at most two conversions run at once, the rest wait.
let activeConversions = 0;
const waitingConversions: Array<() => void> = [];

async function acquireConversionSlot(): Promise<void> {
  if (activeConversions < MAX_CONCURRENT_CONVERSIONS) {
    activeConversions += 1;
    return;
  }
  await new Promise<void>((resolve) => waitingConversions.push(resolve));
}

function releaseConversionSlot(): void {
  const next = waitingConversions.shift();
  if (next !== undefined) {
    next();
    return;
  }
  activeConversions -= 1;
}

async function withConversionSlot<T>(run: () => Promise<T>): Promise<T> {
  await acquireConversionSlot();
  try {
    return await run();
  } finally {
    releaseConversionSlot();
  }
}

/** Runs a command and turns any ffmpeg/ffprobe failure into
 *  `sticker_convert_failed`, logging the exit code and the stderr tail. */
async function runOrFail(
  command: string,
  args: string[],
  timeoutMs: number,
  warn: StickerConvertWarn | undefined,
): Promise<CommandResult> {
  let result: CommandResult;
  try {
    result = await Effect.runPromise(runCommand(command, args, timeoutMs));
  } catch (error) {
    if (error instanceof FfmpegError) {
      logConvertFailure(warn, `${command} could not be run`, error.message);
      throw convertFailed();
    }
    throw error;
  }
  if (result.code !== 0) {
    logConvertFailure(warn, `${command} exited with code ${result.code}`, result.stderr);
    throw convertFailed();
  }
  return result;
}

async function probeVideo(
  ffprobe: string,
  inputPath: string,
  warn: StickerConvertWarn | undefined,
): Promise<ProbedVideo> {
  const result = await runOrFail(
    ffprobe,
    ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', inputPath],
    FFPROBE_TIMEOUT_MS,
    warn,
  );
  let output: FfprobeOutput;
  try {
    output = Schema.decodeUnknownSync(FfprobeJson)(result.stdout);
  } catch {
    logConvertFailure(warn, 'ffprobe did not return JSON', result.stderr);
    throw convertFailed();
  }
  const video = (output.streams ?? []).find((stream) => stream.codec_type === 'video');
  if (video === undefined) {
    throw new HttpError(400, 'sticker_unsupported', 'The file is not a supported sticker');
  }
  const duration = parseDurationSeconds(output.format?.duration ?? video.duration);
  if (duration !== undefined && duration > MAX_DURATION_SECONDS) {
    throw new HttpError(400, 'sticker_too_long', 'Videos are up to 3 seconds');
  }
  return video.codec_name === undefined ? {} : { codecName: video.codec_name };
}

function decodeArgs(codecName: string | undefined): string[] {
  if (codecName === 'vp9') return ['-c:v', 'libvpx-vp9'];
  if (codecName === 'vp8') return ['-c:v', 'libvpx'];
  return [];
}

async function convertWithFfmpeg(
  ffmpeg: string,
  inputPath: string,
  outputPath: string,
  codecName: string | undefined,
  warn: StickerConvertWarn | undefined,
): Promise<Uint8Array> {
  for (const quality of QUALITY_LEVELS) {
    await runOrFail(
      ffmpeg,
      [
        '-nostdin',
        '-y',
        ...decodeArgs(codecName),
        '-i',
        inputPath,
        '-t',
        String(OUTPUT_DURATION_SECONDS),
        '-an',
        '-vf',
        'fps=30,scale=512:512:force_original_aspect_ratio=decrease:flags=lanczos,format=yuva420p',
        '-c:v',
        'libwebp_anim',
        '-loop',
        '0',
        '-lossless',
        '0',
        '-compression_level',
        '4',
        '-q:v',
        String(quality),
        '-f',
        'webp',
        outputPath,
      ],
      FFMPEG_TIMEOUT_MS,
      warn,
    );
    let output: Buffer;
    try {
      output = await readFile(outputPath);
    } catch {
      logConvertFailure(warn, 'ffmpeg produced no output', '');
      throw convertFailed();
    }
    if (output.byteLength <= STICKER_MAX_BYTES) {
      return new Uint8Array(output);
    }
  }
  throw new HttpError(413, 'sticker_too_large', 'The sticker is larger than 512 KiB');
}

/** The real converter: probe, convert at falling quality, keep the first
 *  output that fits. The temp folder always goes away. */
export function createStickerConverter(paths: StickerConverterPaths = {}): StickerConverter {
  const ffmpeg = paths.ffmpeg ?? 'ffmpeg';
  const ffprobe = paths.ffprobe ?? 'ffprobe';
  const warn = paths.warn;

  return {
    toAnimatedWebp(bytes: Uint8Array, kind: ConvertibleKind): Promise<Uint8Array> {
      return withConversionSlot(async () => {
        const dir = await mkdtemp(join(tmpdir(), 'zilar-sticker-'));
        try {
          const inputPath = join(dir, `input.${kind}`);
          const outputPath = join(dir, 'out.webp');
          await writeFile(inputPath, bytes);
          const probed = await probeVideo(ffprobe, inputPath, warn);
          return await convertWithFfmpeg(ffmpeg, inputPath, outputPath, probed.codecName, warn);
        } finally {
          await rm(dir, { recursive: true, force: true }).catch(() => {});
        }
      });
    },
  };
}

/** The shared converter the sticker service falls back to. */
export const defaultConverter: StickerConverter = createStickerConverter();
