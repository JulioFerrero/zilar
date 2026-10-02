import { describe, expect, it, vi } from 'vitest';
import {
  createTelegramClient,
  parseTelegramPackInput,
  TELEGRAM_API_HOST,
  TelegramImportError,
  type TelegramClient,
  type TelegramStickerSet,
} from './telegram-import';

describe('parseTelegramPackInput', () => {
  it('accepts a bare pack name', () => {
    expect(parseTelegramPackInput('FunCats_123')).toBe('FunCats_123');
  });

  it('accepts https t.me links with a query string', () => {
    expect(parseTelegramPackInput('https://t.me/addstickers/FunCats?utm_source=x')).toBe('FunCats');
  });

  it('accepts http t.me links', () => {
    expect(parseTelegramPackInput('http://t.me/addstickers/FunCats')).toBe('FunCats');
  });

  it('accepts tg:// links', () => {
    expect(parseTelegramPackInput('tg://addstickers?set=FunCats')).toBe('FunCats');
  });

  it('rejects hostile strings before any request', () => {
    const hostile = [
      '',
      '   ',
      'https://t.me/addstickers/',
      'https://evil.com/addstickers/FunCats',
      'https://t.me/addstickers/../etc/passwd',
      'https://t.me/addstickers/Fun%20Cats',
      'tg://addstickers?set=',
      'tg://addstickers?set=Fun-Cats!',
      'a'.repeat(65),
      '../../etc/passwd',
      'FunCats; DROP TABLE stickers',
      'https://t.me/addstickers/FunCats\nSet-Cookie: x=1',
    ];
    for (const input of hostile) {
      expect(() => parseTelegramPackInput(input), `input: ${input}`).toThrow(TelegramImportError);
    }
  });
});

function stickerSet(overrides: Partial<TelegramStickerSet> = {}): TelegramStickerSet {
  return {
    name: 'FunCats',
    title: 'Fun Cats',
    isCustomEmoji: false,
    stickers: [],
    ...overrides,
  };
}

describe('createTelegramClient', () => {
  const secretToken = 'TEST-TOKEN-SECRET-VALUE-12345';

  function captureFetch(handler: (url: string) => Response | Promise<Response>): {
    fetch: typeof fetch;
    calls: string[];
  } {
    const calls: string[] = [];
    const fetchImpl: typeof fetch = (async (url: unknown) => {
      calls.push(String(url));
      return handler(String(url));
    }) as typeof fetch;
    return { fetch: fetchImpl, calls };
  }

  function okJson(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  it('contacts only the Telegram host over https with no redirects', async () => {
    const { fetch: fetchImpl, calls } = captureFetch((url) => {
      if (url.includes('/getStickerSet')) {
        return okJson({ ok: true, result: { name: 'x', stickers: [] } });
      }
      return okJson({ ok: true, result: { file_path: 'stickers/a.webp' } });
    });
    const client = createTelegramClient(secretToken, fetchImpl);
    await client.getStickerSet('FunCats');
    expect(calls).toHaveLength(1);
    expect(new URL(calls[0]!).hostname).toBe(TELEGRAM_API_HOST);
    expect(new URL(calls[0]!).protocol).toBe('https:');
  });

  it('maps a 400 to pack_not_found without Telegram text', async () => {
    const { fetch: fetchImpl } = captureFetch(() =>
      okJson({ ok: false, error_code: 400, description: 'Bad Request: STICKERSET_INVALID' }, 400),
    );
    const client = createTelegramClient(secretToken, fetchImpl);
    const error = await client.getStickerSet('Nope').catch((cause: unknown) => cause);
    expect(error).toBeInstanceOf(TelegramImportError);
    expect((error as TelegramImportError).code).toBe('pack_not_found');
    expect(String((error as Error).message)).not.toContain('STICKERSET_INVALID');
  });

  it('maps a 401 to invalid_token for the integrations page to verify a key', async () => {
    const { fetch: fetchImpl, calls } = captureFetch(() =>
      okJson({ ok: false, error_code: 401, description: 'Unauthorized: bot was blocked' }, 401),
    );
    const client = createTelegramClient(secretToken, fetchImpl);
    const error = await client.getMe().catch((cause: unknown) => cause);
    expect(error).toBeInstanceOf(TelegramImportError);
    expect((error as TelegramImportError).code).toBe('invalid_token');
    expect(String((error as Error).message)).not.toContain(secretToken);
    expect(calls[0]).toContain('/getMe');
  });

  it('answers getMe ok for a valid token', async () => {
    const { fetch: fetchImpl } = captureFetch(() =>
      okJson({ ok: true, result: { id: 1, is_bot: true, first_name: 'Z' } }),
    );
    const client = createTelegramClient(secretToken, fetchImpl);
    await expect(client.getMe()).resolves.toEqual({ ok: true });
  });

  it('retries a 429 once after retry_after (capped at 5 s), then reports try_later', async () => {
    let calls = 0;
    let waitedMs = 0;
    const fetch429: typeof fetch = (async () => {
      calls += 1;
      return okJson(
        {
          ok: false,
          error_code: 429,
          description: 'Too Many Requests',
          parameters: { retry_after: 120 },
        },
        429,
      );
    }) as typeof fetch;
    const client = createTelegramClient(secretToken, fetch429);
    // The retry waits `retry_after` capped at 5 s: the test would sleep 5 s
    // on real timers, so assert the cap on the wait instead of the clock.
    // (The fetch timeout also arms a 10 s timer; only the retry wait is
    // recorded here.)
    const sleepSpy = vi.spyOn(globalThis, 'setTimeout').mockImplementation(((
      handler: () => void,
      ms?: number,
    ) => {
      if (ms !== undefined && ms < 10_000) {
        waitedMs = ms;
      }
      handler();
      return 0 as unknown as NodeJS.Timeout;
    }) as typeof setTimeout);
    try {
      const error = await client.getStickerSet('FunCats').catch((cause: unknown) => cause);
      expect(calls).toBe(2);
      expect(waitedMs).toBe(5000);
      expect((error as TelegramImportError).code).toBe('try_later');
    } finally {
      sleepSpy.mockRestore();
    }
  });

  it('never leaks the token in errors, even on network failure', async () => {
    const failingFetch: typeof fetch = (async () => {
      throw new Error(`socket hung up calling bot${secretToken}/getStickerSet`);
    }) as typeof fetch;
    const client = createTelegramClient(secretToken, failingFetch);
    const error = await client.getStickerSet('FunCats').catch((cause: unknown) => cause);
    expect(error).toBeInstanceOf(TelegramImportError);
    const serialised = JSON.stringify(error, Object.getOwnPropertyNames(error));
    expect(serialised).not.toContain(secretToken);
  });

  it('refuses redirects and signals oversized files for skip-and-count', async () => {
    const redirect = {
      fetch: (async () =>
        new Response(null, {
          status: 302,
          headers: { location: 'https://evil.test/x' },
        })) as typeof fetch,
    };
    const client = createTelegramClient(secretToken, redirect.fetch);
    const error = await client.getStickerSet('FunCats').catch((cause: unknown) => cause);
    expect((error as TelegramImportError).code).toBe('try_later');

    const big = new Uint8Array(2 * 1024 * 1024);
    const bigFetch = captureFetch((url) => {
      if (url.includes('/getFile')) {
        return okJson({ ok: true, result: { file_path: 'stickers/big.webp' } });
      }
      return new Response(big, { status: 200 });
    });
    const bigClient = createTelegramClient(secretToken, bigFetch.fetch);
    // The client signals `file_too_large`; the importer (service.ts) turns
    // it into a skip-and-count, never a failed request.
    await expect(bigClient.downloadFile('file-id')).rejects.toMatchObject({
      code: 'file_too_large',
    });
  });

  it('parses the sticker set shape used by the importer', async () => {
    const { fetch: fetchImpl } = captureFetch(() =>
      okJson({
        ok: true,
        result: {
          name: 'FunCats',
          title: 'Fun Cats',
          stickers: [
            { file_id: 'a', file_unique_id: 'u-a', emoji: '🐱' },
            { file_id: 'b', file_unique_id: 'u-b', emoji: '😂', is_animated: true },
            { file_id: 'c', file_unique_id: 'u-c', is_video: true },
          ],
        },
      }),
    );
    const client = createTelegramClient(secretToken, fetchImpl);
    const set = await client.getStickerSet('FunCats');
    expect(set).toEqual(
      stickerSet({
        stickers: [
          { sourceId: 'u-a', fileId: 'a', emoji: '🐱', animated: false },
          { sourceId: 'u-b', fileId: 'b', emoji: '😂', animated: true },
          { sourceId: 'u-c', fileId: 'c', emoji: null, animated: true },
        ],
      }),
    );
  });

  it('downloads a file through getFile then the file URL', async () => {
    const bytes = new TextEncoder().encode('sticker-file-bytes');
    const { fetch: fetchImpl, calls } = captureFetch((url) => {
      if (url.includes('/getFile')) {
        return okJson({ ok: true, result: { file_path: 'stickers/a.webp' } });
      }
      return new Response(bytes, { status: 200 });
    });
    const client: TelegramClient = createTelegramClient(secretToken, fetchImpl);
    const downloaded = await client.downloadFile('file-id');
    expect(downloaded).toEqual(bytes);
    expect(calls.some((call) => call.includes('/getFile'))).toBe(true);
    expect(calls.some((call) => call.includes('/file/bot'))).toBe(true);
  });
});
