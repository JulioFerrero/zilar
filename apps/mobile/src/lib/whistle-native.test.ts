import { describe, expect, it, vi } from 'vitest';

import {
  normalizeWhistleLanguage,
  WHISTLE_LANGUAGES,
  WHISTLE_MODEL_BYTES,
  WHISTLE_MODEL_SHA256,
  WHISTLE_MODEL_URL,
} from 'zilar-whistle/src/model';
import { parseWhistleResult, WhistleError, whistleErrorFor } from 'zilar-whistle/src/result';
import { toLocalPath, transcribe } from 'zilar-whistle/src/transcribe';
import { getNativeModule } from 'zilar-whistle/src/ZilarWhistleModule';

vi.mock('zilar-whistle/src/ZilarWhistleModule', () => ({
  getNativeModule: vi.fn(),
}));

const mockedGetNative = vi.mocked(getNativeModule);

function nativeStub(overrides: Record<string, unknown> = {}) {
  const stub = {
    isAvailable: vi.fn(() => true),
    modelStatus: vi.fn(() => 'missing'),
    loadModel: vi.fn(async () => 'ready'),
    transcribeFile: vi.fn(async () => ({
      text: 'hello',
      language: 'en',
      ttftMs: 10,
      decodeTps: 20,
      audioMs: 1000,
    })),
    ...overrides,
  };
  mockedGetNative.mockReturnValue(stub as unknown as ReturnType<typeof getNativeModule>);
  return stub;
}

describe('whistle model constants (T-0177)', () => {
  it('pins the model URL, size and checksum from the spec', () => {
    expect(WHISTLE_MODEL_URL).toBe(
      'https://huggingface.co/Cactus-Compute/whistle/resolve/b358ddadd89b7a713b5aa131f23032d3cca1b251/whistle.cact',
    );
    expect(WHISTLE_MODEL_BYTES).toBe(16919407);
    expect(WHISTLE_MODEL_SHA256).toBe(
      'b6e02f048568ac5d01a2042556c658061e699acbc0aa2a1439f52f3d461dffeb',
    );
    expect([...WHISTLE_LANGUAGES]).toEqual(['en', 'de', 'fr', 'es', 'it', 'nl', 'pl']);
  });

  it('normalises languages, falling back to auto-detect', () => {
    expect(normalizeWhistleLanguage('EN')).toBe('en');
    expect(normalizeWhistleLanguage('es')).toBe('es');
    expect(normalizeWhistleLanguage('zh')).toBeNull();
    expect(normalizeWhistleLanguage('')).toBeNull();
    expect(normalizeWhistleLanguage(undefined)).toBeNull();
  });
});

describe('whistle result parsing (T-0177)', () => {
  it('accepts a well-formed native result', () => {
    expect(
      parseWhistleResult({ text: 'hi', language: 'en', ttftMs: 1, decodeTps: 2, audioMs: 500 }),
    ).toEqual({ text: 'hi', language: 'en', ttftMs: 1, decodeTps: 2, audioMs: 500 });
  });

  it('rejects a malformed JSON result with bad_result', () => {
    expect(() => parseWhistleResult({ text: 'hi' })).toThrowError(WhistleError);
    try {
      parseWhistleResult({ text: 'hi' });
      expect.unreachable();
    } catch (error) {
      expect((error as WhistleError).code).toBe('bad_result');
    }
  });

  it('falls back to auto-detect on an unknown language tag', () => {
    const parsed = parseWhistleResult({
      text: 'hi',
      language: 'xx',
      ttftMs: 0,
      decodeTps: 0,
      audioMs: 10,
    });
    expect(parsed.language).toBe('');
  });

  it('maps native codes to fixed errors', () => {
    expect(whistleErrorFor({ code: 'unavailable' }).code).toBe('unavailable');
    expect(whistleErrorFor({ code: 'model_missing' }).code).toBe('model_missing');
    expect(whistleErrorFor({ code: 'not_audio' }).code).toBe('not_audio');
    expect(whistleErrorFor(new WhistleError('bad_checksum', 'x')).code).toBe('bad_checksum');
    expect(whistleErrorFor(new Error('boom')).code).toBe('transcribe_failed');
  });
});

describe('whistle transcribe wrapper (T-0177)', () => {
  it('strips the file:// scheme and returns timings', async () => {
    const stub = nativeStub();
    const result = await transcribe('file:///cache/rec.m4a', { language: 'en' });
    expect(stub.transcribeFile).toHaveBeenCalledWith('/cache/rec.m4a', 'en');
    expect(result.text).toBe('hello');
    expect(result.language).toBe('en');
    expect(result.audioMs).toBe(1000);
    expect(result.wallMs).toBeGreaterThanOrEqual(0);
  });

  it('a second concurrent transcribe waits for the first', async () => {
    const order: string[] = [];
    nativeStub({
      transcribeFile: vi.fn(async (path: string) => {
        order.push(`start:${path}`);
        await new Promise((resolve) => setTimeout(resolve, 20));
        order.push(`end:${path}`);
        return { text: `said:${path}`, language: 'en', ttftMs: 0, decodeTps: 0, audioMs: 1 };
      }),
    });
    const [first, second] = await Promise.all([
      transcribe('file:///a.m4a'),
      transcribe('file:///b.m4a'),
    ]);
    expect(first.text).toBe('said:/a.m4a');
    expect(second.text).toBe('said:/b.m4a');
    expect(order).toEqual(['start:/a.m4a', 'end:/a.m4a', 'start:/b.m4a', 'end:/b.m4a']);
  });

  it('reports unavailable on a non-arm64 stub', async () => {
    mockedGetNative.mockReturnValue(null);
    await expect(transcribe('file:///a.m4a')).rejects.toMatchObject({ code: 'unavailable' });
  });

  it('keeps file paths intact', () => {
    expect(toLocalPath('file:///cache/a.m4a')).toBe('/cache/a.m4a');
    expect(toLocalPath('/cache/a.m4a')).toBe('/cache/a.m4a');
  });
});
