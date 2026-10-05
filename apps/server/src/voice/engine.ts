import { spawn } from 'node:child_process';

const PROBE_TIMEOUT_MS = 10_000;
const CONVERT_TIMEOUT_MS = 30_000;

/**
 * Container format names ffprobe reports for audio we accept. `format_name`
 * is a comma-separated list (e.g. `matroska,webm`), so any token counts.
 */
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
  /**
   * From the container, when the container carries one. MediaRecorder WebM
   * often does not, which is why the converted file's duration is authoritative.
   */
  durationMs?: number;
  formatName: string;
}

export interface VoiceEngine {
  /** Reads the container and rejects anything that is not a plain audio file. */
  probe(inputPath: string): Promise<ProbedAudio>;
  /** Converts any accepted input to AAC in an M4A container. */
  convert(inputPath: string, outputPath: string): Promise<void>;
}

/** The input is a container ffprobe does not recognize as audio. */
export class NotAudioError extends Error {
  constructor(reason: string) {
    super(reason);
    this.name = 'NotAudioError';
  }
}

/** ffmpeg or ffprobe failed or timed out. */
export class FfmpegError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FfmpegError';
  }
}

export interface FfmpegEnginePaths {
  ffmpeg?: string;
  ffprobe?: string;
}

interface CommandResult {
  code: number;
  stdout: string;
  stderr: string;
}

// Runs a command with no shell, a hard timeout and captured output. Killing the
// process on timeout keeps a hostile input from pinning the server. A non-zero
// exit is handed back to the caller, which decides what it means.
function run(command: string, args: string[], timeoutMs: number): Promise<CommandResult> {
  return new Promise<CommandResult>((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let settled = false;

    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        child.kill('SIGKILL');
        reject(new FfmpegError(`${command} timed out after ${timeoutMs}ms`));
      }
    }, timeoutMs);

    child.stdout.on('data', (chunk: Buffer) => stdout.push(chunk));
    child.stderr.on('data', (chunk: Buffer) => stderr.push(chunk));
    child.on('error', (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(new FfmpegError(`${command} could not be started: ${error.message}`));
    });
    child.on('close', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({
        code: code ?? -1,
        stdout: Buffer.concat(stdout).toString('utf8'),
        stderr: Buffer.concat(stderr).toString('utf8'),
      });
    });
  });
}

interface FfprobeOutput {
  format?: { format_name?: string; duration?: string };
  streams?: Array<{ codec_type?: string; duration?: string }>;
}

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

/**
 * The real engine: `ffprobe` to validate and measure, `ffmpeg` to convert.
 * The binaries come from PATH unless overridden (tests pass absolute paths).
 */
export function createFfmpegEngine(paths: FfmpegEnginePaths = {}): VoiceEngine {
  const ffmpeg = paths.ffmpeg ?? 'ffmpeg';
  const ffprobe = paths.ffprobe ?? 'ffprobe';

  return {
    async probe(inputPath: string): Promise<ProbedAudio> {
      const result = await run(
        ffprobe,
        ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', inputPath],
        PROBE_TIMEOUT_MS,
      );

      if (result.code !== 0) {
        throw new NotAudioError(`ffprobe rejected the upload (exit ${result.code})`);
      }

      let output: FfprobeOutput;
      try {
        output = JSON.parse(result.stdout) as FfprobeOutput;
      } catch {
        throw new NotAudioError('ffprobe did not return JSON');
      }

      const streams = output.streams ?? [];
      if (streams.length === 0) {
        throw new NotAudioError('the upload has no streams');
      }
      if (!streams.every((stream) => stream.codec_type === 'audio')) {
        throw new NotAudioError('the upload is not audio-only');
      }
      if (!acceptsFormat(output.format?.format_name)) {
        throw new NotAudioError(
          `unsupported container: ${output.format?.format_name ?? 'unknown'}`,
        );
      }

      const durationMs = parseDurationMs(output);
      const probed: ProbedAudio = { formatName: output.format?.format_name ?? 'unknown' };
      if (durationMs !== undefined) {
        probed.durationMs = durationMs;
      }
      return probed;
    },

    async convert(inputPath: string, outputPath: string): Promise<void> {
      const result = await run(
        ffmpeg,
        [
          '-nostdin',
          '-y',
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
        throw new FfmpegError(`ffmpeg exited with code ${result.code}`);
      }
    },
  };
}
