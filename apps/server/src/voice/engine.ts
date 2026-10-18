import { Effect, Schema } from 'effect';
import { FfmpegError, runCommand } from '../media/run-command';

export { FfmpegError };

const PROBE_TIMEOUT_MS = 10_000;
const CONVERT_TIMEOUT_MS = 30_000;

/** Container names ffprobe reports; `format_name` is comma-separated, so any token counts. */
const AUDIO_FORMATS = new Set([
  'aac',
  'aiff',
  'amr',
  'caf',
  'flac',
  'matroska',
  'm4a',
  'mj2',
  'mov',
  'mp3',
  'mp4',
  'oga',
  'ogg',
  'wav',
  'webm',
  '3gp',
  '3g2',
]);

export interface ProbedAudio {
  /** MediaRecorder WebM often has none, which is why the converted duration is authoritative. */
  durationMs?: number;
  formatName: string;
}

export interface VoiceEngine {
  probe(inputPath: string): Promise<ProbedAudio>;
  convert(inputPath: string, outputPath: string): Promise<void>;
}

export class NotAudioError extends Error {
  constructor(reason: string) {
    super(reason);
    this.name = 'NotAudioError';
  }
}

export interface FfmpegEnginePaths {
  ffmpeg?: string;
  ffprobe?: string;
}

const FfprobeJson = Schema.fromJsonString(
  Schema.Struct({
    format: Schema.optional(
      Schema.Struct({
        format_name: Schema.optional(Schema.String),
        duration: Schema.optional(Schema.String),
      }),
    ),
    streams: Schema.optional(
      Schema.Array(
        Schema.Struct({
          codec_type: Schema.optional(Schema.String),
          duration: Schema.optional(Schema.String),
        }),
      ),
    ),
  }),
);

type FfprobeOutput = typeof FfprobeJson.Type;

function parseDurationMs(output: FfprobeOutput): number | undefined {
  const raw = output.format?.duration ?? output.streams?.[0]?.duration;
  if (raw === undefined) return undefined;
  const seconds = Number.parseFloat(raw);
  if (!Number.isFinite(seconds) || seconds <= 0) return undefined;
  return Math.round(seconds * 1000);
}

function acceptsFormat(formatName: string | undefined): boolean {
  if (formatName === undefined) return false;
  return formatName.split(',').some((token) => AUDIO_FORMATS.has(token.trim().toLowerCase()));
}

export const probeEffect = Effect.fnUntraced(function* (
  ffprobe: string,
  inputPath: string,
): Effect.fn.Return<ProbedAudio, NotAudioError | FfmpegError> {
  const result = yield* runCommand(
    ffprobe,
    [
      '-v',
      'error',
      '-print_format',
      'json',
      '-show_format',
      '-show_streams',
      '-protocol_whitelist',
      'file,pipe',
      inputPath,
    ],
    PROBE_TIMEOUT_MS,
  );

  if (result.code !== 0) {
    return yield* Effect.fail(
      new NotAudioError(`ffprobe rejected the upload (exit ${result.code})`),
    );
  }

  const output = yield* Schema.decodeUnknownEffect(FfprobeJson)(result.stdout).pipe(
    Effect.mapError(() => new NotAudioError('ffprobe did not return JSON')),
  );

  const streams = output.streams ?? [];
  if (streams.length === 0) {
    return yield* Effect.fail(new NotAudioError('the upload has no streams'));
  }
  if (!streams.every((stream) => stream.codec_type === 'audio')) {
    return yield* Effect.fail(new NotAudioError('the upload is not audio-only'));
  }
  if (!acceptsFormat(output.format?.format_name)) {
    return yield* Effect.fail(
      new NotAudioError(`unsupported container: ${output.format?.format_name ?? 'unknown'}`),
    );
  }

  const durationMs = parseDurationMs(output);
  const probed: ProbedAudio = { formatName: output.format?.format_name ?? 'unknown' };
  if (durationMs !== undefined) {
    probed.durationMs = durationMs;
  }
  return probed;
});

export const convertEffect = Effect.fnUntraced(function* (
  ffmpeg: string,
  inputPath: string,
  outputPath: string,
): Effect.fn.Return<void, FfmpegError> {
  const result = yield* runCommand(
    ffmpeg,
    [
      '-nostdin',
      '-y',
      '-protocol_whitelist',
      'file,pipe',
      '-i',
      inputPath,
      '-vn',
      '-c:a',
      'aac',
      '-b:a',
      '96k',
      '-movflags',
      '+faststart',
      '-f',
      'mp4',
      outputPath,
    ],
    CONVERT_TIMEOUT_MS,
  );
  if (result.code !== 0) {
    return yield* Effect.fail(new FfmpegError(`ffmpeg exited with code ${result.code}`));
  }
});

export function createFfmpegEngine(paths: FfmpegEnginePaths = {}): VoiceEngine {
  const ffmpeg = paths.ffmpeg ?? 'ffmpeg';
  const ffprobe = paths.ffprobe ?? 'ffprobe';

  return {
    probe(inputPath: string): Promise<ProbedAudio> {
      return Effect.runPromise(probeEffect(ffprobe, inputPath));
    },
    convert(inputPath: string, outputPath: string): Promise<void> {
      return Effect.runPromise(convertEffect(ffmpeg, inputPath, outputPath));
    },
  };
}
