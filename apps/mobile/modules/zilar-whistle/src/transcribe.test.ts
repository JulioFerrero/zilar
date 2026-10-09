import { describe, expect, it, vi } from 'vitest';

import { WhistleError } from './result';
import { isAvailable, planRangesMs, toLocalPath, transcribe } from './transcribe';
import { getNativeModule } from './ZilarWhistleModule';

vi.mock('./ZilarWhistleModule', () => ({
  getNativeModule: vi.fn(),
}));

const RESULT = {
  text: 'hello',
  language: 'en',
  ttftMs: 10,
  decodeTps: 20,
  audioMs: 1000,
};

const LONG_MS = 60_000;

function nativeStub(overrides: Record<string, unknown> = {}) {
  const stub = {
    isAvailable: vi.fn(() => true),
    amplitudeEnvelope: vi.fn(async (_path: string) => [] as number[]),
    transcribeFile: vi.fn(async (_path: string, _language: string | null) => RESULT),
    transcribeRanges: vi.fn(
      async (_path: string, _ranges: Array<[number, number]> | null, _language: string | null) =>
        RESULT,
    ),
    ...overrides,
  };
  vi.mocked(getNativeModule).mockReturnValue(stub as unknown as ReturnType<typeof getNativeModule>);
  return stub;
}

// The ranges must cover the whole clip with no gap: each chunk starts where the last ended.
function expectContiguousCover(
  ranges: Array<[number, number]> | null | undefined,
  totalMs: number,
) {
  expect(ranges).not.toBeNull();
  const list = ranges ?? [];
  expect(list.length).toBeGreaterThan(1);
  expect(list[0]?.[0]).toBe(0);
  expect(list.at(-1)?.[1]).toBe(totalMs);
  list.slice(1).forEach(([start], index) => {
    expect(start).toBe(list[index]?.[1]);
  });
}

describe('whistle transcribe module', () => {
  describe('isAvailable', () => {
    it('is false without a native module', () => {
      vi.mocked(getNativeModule).mockReturnValue(null);
      expect(isAvailable()).toBe(false);
    });

    it('is false when the native check throws', () => {
      nativeStub({
        isAvailable: vi.fn(() => {
          throw new Error('not linked');
        }),
      });
      expect(isAvailable()).toBe(false);
    });

    it('follows the native check', () => {
      nativeStub();
      expect(isAvailable()).toBe(true);
    });
  });

  describe('toLocalPath', () => {
    it('strips the file scheme the recorder adds', () => {
      expect(toLocalPath('file:///data/rec/a.m4a')).toBe('/data/rec/a.m4a');
    });

    it('keeps a path that has no file scheme', () => {
      expect(toLocalPath('/data/rec/a.m4a')).toBe('/data/rec/a.m4a');
    });
  });

  describe('transcribe', () => {
    it('rejects as unavailable without a native module', async () => {
      vi.mocked(getNativeModule).mockReturnValue(null);
      await expect(transcribe('file:///a.m4a')).rejects.toMatchObject({ code: 'unavailable' });
    });

    it('rejects an empty file uri as not_audio', async () => {
      const native = nativeStub();
      await expect(transcribe('')).rejects.toMatchObject({
        code: 'not_audio',
        message: 'That file could not be read as audio',
      });
      expect(native.transcribeFile).not.toHaveBeenCalled();
    });

    it('transcribes a short clip in one native call with a normalised language', async () => {
      const native = nativeStub();
      const transcript = await transcribe('file:///data/rec/a.m4a', { language: 'DE' });
      expect(native.transcribeFile).toHaveBeenCalledWith('/data/rec/a.m4a', 'de');
      expect(native.transcribeRanges).not.toHaveBeenCalled();
      expect(transcript).toMatchObject({
        text: 'hello',
        language: 'en',
        ttftMs: 10,
        decodeTps: 20,
        audioMs: 1000,
      });
      expect(transcript.wallMs).toBeGreaterThanOrEqual(0);
    });

    it('sends a null language when none is given', async () => {
      const native = nativeStub();
      await transcribe('file:///a.m4a');
      expect(native.transcribeFile).toHaveBeenCalledWith('/a.m4a', null);
    });

    it('maps a native rejection to its fixed message', async () => {
      nativeStub({
        transcribeFile: vi.fn(async () => {
          throw { code: 'too_long', message: 'raw text' };
        }),
      });
      await expect(transcribe('file:///a.m4a')).rejects.toMatchObject({
        code: 'too_long',
        message: 'That recording is too long to transcribe on the device',
      });
    });

    it('rejects a malformed native result as bad_result', async () => {
      nativeStub({
        transcribeFile: vi.fn(async () => ({ language: 'en' })),
      });
      await expect(transcribe('file:///a.m4a')).rejects.toBeInstanceOf(WhistleError);
      await expect(transcribe('file:///a.m4a')).rejects.toMatchObject({
        code: 'bad_result',
        message: 'The transcription result was malformed',
      });
    });

    it('plans ranges for a long clip from the given amplitudes and sends them', async () => {
      const native = nativeStub();
      const transcript = await transcribe('file:///data/rec/long.m4a', {
        audioMs: LONG_MS,
        amplitudes: () => 1,
      });
      expect(native.transcribeRanges).toHaveBeenCalledTimes(1);
      const call = native.transcribeRanges.mock.calls[0];
      expect(call?.[0]).toBe('/data/rec/long.m4a');
      expect(call?.[2]).toBeNull();
      expectContiguousCover(call?.[1], LONG_MS);
      expect(native.transcribeFile).not.toHaveBeenCalled();
      expect(transcript.text).toBe('hello');
    });

    it('reads the native envelope for a long clip without amplitudes', async () => {
      const native = nativeStub({
        amplitudeEnvelope: vi.fn(async () => Array.from({ length: LONG_MS / 10 }, () => 1)),
      });
      await transcribe('file:///data/rec/long.m4a', { audioMs: LONG_MS });
      expect(native.amplitudeEnvelope).toHaveBeenCalledWith('/data/rec/long.m4a');
      expectContiguousCover(native.transcribeRanges.mock.calls[0]?.[1], LONG_MS);
    });

    it('falls back to even windows when the envelope read fails', async () => {
      const native = nativeStub({
        amplitudeEnvelope: vi.fn(async () => {
          throw new Error('decoder failed');
        }),
      });
      await expect(
        transcribe('file:///data/rec/long.m4a', { audioMs: LONG_MS }),
      ).resolves.toMatchObject({ text: 'hello' });
      expectContiguousCover(native.transcribeRanges.mock.calls[0]?.[1], LONG_MS);
    });

    it('runs one transcription at a time and the second waits for the first', async () => {
      let release: () => void = () => undefined;
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      const native = nativeStub({
        transcribeFile: vi
          .fn()
          .mockImplementationOnce(async () => {
            await gate;
            return RESULT;
          })
          .mockImplementation(async () => RESULT),
      });
      const first = transcribe('file:///first.m4a');
      const second = transcribe('file:///second.m4a');
      await new Promise((resolve) => setTimeout(resolve, 10));
      expect(native.transcribeFile).toHaveBeenCalledTimes(1);
      expect(native.transcribeFile).toHaveBeenCalledWith('/first.m4a', null);
      release();
      await Promise.all([first, second]);
      expect(native.transcribeFile).toHaveBeenCalledTimes(2);
      expect(native.transcribeFile).toHaveBeenLastCalledWith('/second.m4a', null);
    });

    it('releases the guard after a failure so later calls still run', async () => {
      const native = nativeStub({
        transcribeFile: vi
          .fn()
          .mockImplementationOnce(async () => {
            throw { code: 'transcribe_failed', message: 'engine stopped' };
          })
          .mockImplementation(async () => RESULT),
      });
      await expect(transcribe('file:///first.m4a')).rejects.toMatchObject({
        code: 'transcribe_failed',
        message: 'engine stopped',
      });
      await expect(transcribe('file:///second.m4a')).resolves.toMatchObject({ text: 'hello' });
      expect(native.transcribeFile).toHaveBeenCalledTimes(2);
    });
  });

  describe('planRangesMs', () => {
    it('plans nothing for a short, unknown or non-finite length', async () => {
      nativeStub();
      await expect(planRangesMs('/a.m4a', { audioMs: 28_000 })).resolves.toBeNull();
      await expect(planRangesMs({})).resolves.toBeNull();
      await expect(planRangesMs({ audioMs: Number.NaN })).resolves.toBeNull();
      await expect(planRangesMs({ audioMs: Number.POSITIVE_INFINITY })).resolves.toBeNull();
    });

    it('covers a long clip with contiguous ranges when amplitudes are given', async () => {
      nativeStub();
      const ranges = await planRangesMs({ audioMs: LONG_MS, amplitudes: () => 1 });
      expectContiguousCover(ranges, LONG_MS);
    });
  });
});
