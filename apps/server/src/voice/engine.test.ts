import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { NotAudioError, createFfmpegEngine, type VoiceEngine } from './engine';

// Real-ffmpeg test. It needs the ffmpeg/ffprobe binaries the dev machine has,
// so it only runs when asked for:
//
//   ZILAR_VOICE_INTEGRATION=1 pnpm --filter @zilar/server test
const enabled = process.env.ZILAR_VOICE_INTEGRATION === '1';

const SAMPLE_RATE = 8000;
const SECONDS = 1;
const FFMPEG = '/opt/homebrew/bin/ffmpeg';
const FFPROBE = '/opt/homebrew/bin/ffprobe';

function wavBytes(): Buffer {
  const samples = SAMPLE_RATE * SECONDS;
  const data = Buffer.alloc(samples * 2);
  for (let index = 0; index < samples; index += 1) {
    const value = Math.round(Math.sin((index / SAMPLE_RATE) * 2 * Math.PI * 440) * 12000);
    data.writeInt16LE(value, index * 2);
  }
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + data.length, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(SAMPLE_RATE, 24);
  header.writeUInt32LE(SAMPLE_RATE * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36);
  header.writeUInt32LE(data.length, 40);
  return Buffer.concat([header, data]);
}

describe.skipIf(!enabled)('ffmpeg voice engine (real binaries)', () => {
  let dir: string;
  let engine: VoiceEngine;

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'zilar-voice-test-'));
    engine = createFfmpegEngine(
      existsSync(FFMPEG) && existsSync(FFPROBE) ? { ffmpeg: FFMPEG, ffprobe: FFPROBE } : {},
    );
  });

  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('probes a wav and converts it to AAC/M4A', async () => {
    const input = join(dir, 'input.wav');
    const output = join(dir, 'output.m4a');
    await writeFile(input, wavBytes());

    const probed = await engine.probe(input);
    expect(probed.durationMs).toBeGreaterThan(900);
    expect(probed.durationMs).toBeLessThan(1100);

    await engine.convert(input, output);
    const converted = await engine.probe(output);
    expect(converted.formatName).toContain('mp4');
    expect(converted.durationMs).toBeGreaterThan(900);
    expect(converted.durationMs).toBeLessThan(1100);
  });

  it('rejects a text file as not audio', async () => {
    const input = join(dir, 'not-audio.txt');
    await writeFile(input, 'this is not a recording');
    await expect(engine.probe(input)).rejects.toBeInstanceOf(NotAudioError);
  });
});
