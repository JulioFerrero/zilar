// T-1862: the media fetch is the security edge, so this test drives it with
// an injected resolver and transport. No test opens a socket.
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Effect } from 'effect';
import { SqlClient } from 'effect/sql';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestContext, testSql, type TestContext } from '../test-support';
import { seedAi, seedUser } from '../test-support/seed';
import type { DnsLookup, PinnedFetcher } from '../web-tools/guarded-fetch';
import { fetchCardMedia } from './fetch';
import { cardMediaPath, getCardMedia } from './service';

const ROOM_JID = 'room@rooms.zilar.localhost';
const PUBLIC_RESOLVER: DnsLookup = async () => ['93.184.216.34'];
const PRIVATE_RESOLVER: DnsLookup = async () => ['10.0.0.5'];

const SOF0 = segment(
  0xc0,
  [0x08, 0x00, 0x10, 0x00, 0x10, 0x03, 0x01, 0x11, 0x00, 0x02, 0x11, 0x01, 0x03, 0x11, 0x01],
);
const SOS = segment(0xda, [0x03, 0x01, 0x00, 0x02, 0x11, 0x03, 0x11, 0x00, 0x3f, 0x00]);
const APP1_EXIF = segment(0xe1, [0x45, 0x78, 0x69, 0x66, 0x00, 0x00, 0x00, 0x00]);
const JPEG_WITH_EXIF = new Uint8Array([
  0xff,
  0xd8,
  ...APP1_EXIF,
  ...SOF0,
  ...SOS,
  0x12,
  0x34,
  0xff,
  0xd9,
]);
const JPEG_WITHOUT_EXIF = new Uint8Array([0xff, 0xd8, ...SOF0, ...SOS, 0x12, 0x34, 0xff, 0xd9]);

function segment(marker: number, payload: readonly number[]): number[] {
  const length = payload.length + 2;
  return [0xff, marker, (length >>> 8) & 0xff, length & 0xff, ...payload];
}

function okFetcher(raw: Uint8Array, rawContentType: string): PinnedFetcher {
  return async () => ({
    response: { status: 200, rawContentType, location: null },
    raw,
  });
}

function hasSegment(bytes: Uint8Array, marker: number): boolean {
  let offset = 2;
  while (offset + 4 <= bytes.length) {
    if (bytes[offset] !== 0xff) {
      return false;
    }
    const found = bytes[offset + 1]!;
    if (found === marker) {
      return true;
    }
    if (found === 0xda || found === 0xd9) {
      return false;
    }
    const length = bytes[offset + 2]! * 0x100 + bytes[offset + 3]!;
    offset += 2 + length;
  }
  return false;
}

describe('fetchCardMedia', () => {
  let context: TestContext;
  let dir: string;
  let aiId: string;

  beforeEach(async () => {
    context = await createTestContext();
    dir = await mkdtemp(join(tmpdir(), 'zilar-card-media-fetch-'));
    const ownerId = await seedUser(context);
    ({ aiId } = await seedAi(context, ownerId));
  });

  afterEach(async () => {
    await context.close();
    await rm(dir, { recursive: true, force: true });
  });

  async function storedRows(): Promise<number> {
    const [row] = await testSql(context)(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        return yield* sql<{ total: number }>`SELECT count(*)::int AS total FROM card_media`;
      }),
    );
    return row?.total ?? 0;
  }

  it('refuses an http URL without fetching or storing anything', async () => {
    let fetched = 0;
    const fetcher: PinnedFetcher = async () => {
      fetched += 1;
      throw new Error('the transport must not run');
    };

    const result = await fetchCardMedia(
      { db: context.db, dir, resolver: PUBLIC_RESOLVER, fetcher },
      {
        aiId,
        roomJid: ROOM_JID,
        url: 'http://files.example.com/photo.png',
        kind: 'image',
      },
    );

    expect(result).toEqual({ ok: false, reason: 'only https urls are allowed' });
    expect(fetched).toBe(0);
    expect(await storedRows()).toBe(0);
    expect(await readdir(dir)).toEqual([]);
  });

  it('refuses a host that resolves to a private address', async () => {
    let fetched = 0;
    const fetcher: PinnedFetcher = async () => {
      fetched += 1;
      throw new Error('the transport must not run');
    };

    const result = await fetchCardMedia(
      { db: context.db, dir, resolver: PRIVATE_RESOLVER, fetcher },
      {
        aiId,
        roomJid: ROOM_JID,
        url: 'https://files.example.com/photo.png',
        kind: 'image',
      },
    );

    expect(result).toEqual({ ok: false, reason: 'the file could not be fetched' });
    expect(fetched).toBe(0);
    expect(await storedRows()).toBe(0);
    expect(await readdir(dir)).toEqual([]);
  });

  it('refuses bytes declared as an image when they sniff as HTML', async () => {
    const html = new TextEncoder().encode('<!doctype html><html><body>not an image</body></html>');

    const result = await fetchCardMedia(
      { db: context.db, dir, resolver: PUBLIC_RESOLVER, fetcher: okFetcher(html, 'image/png') },
      {
        aiId,
        roomJid: ROOM_JID,
        url: 'https://files.example.com/photo.png',
        kind: 'image',
      },
    );

    expect(result).toEqual({ ok: false, reason: 'the file is not a supported image' });
    expect(await storedRows()).toBe(0);
    expect(await readdir(dir)).toEqual([]);
  });

  it('strips the Exif segment before storing a JPEG', async () => {
    const result = await fetchCardMedia(
      {
        db: context.db,
        dir,
        resolver: PUBLIC_RESOLVER,
        fetcher: okFetcher(JPEG_WITH_EXIF, 'image/jpeg'),
      },
      {
        aiId,
        roomJid: ROOM_JID,
        url: 'https://files.example.com/photos/photo.jpg',
        kind: 'image',
      },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.media.mime).toBe('image/jpeg');
    expect(result.media.width).toBe(16);
    expect(result.media.height).toBe(16);
    expect(result.media.name).toBe('photo.jpg');
    expect(result.media.size).toBe(JPEG_WITHOUT_EXIF.byteLength);

    const row = await getCardMedia(context.db, result.media.id);
    expect(row?.mime).toBe('image/jpeg');
    expect(row?.width).toBe(16);
    expect(row?.height).toBe(16);
    expect(row?.name).toBe('photo.jpg');
    expect(row?.size).toBe(JPEG_WITHOUT_EXIF.byteLength);

    const stored = new Uint8Array(await readFile(cardMediaPath(dir, row!)));
    expect(hasSegment(stored, 0xe1)).toBe(false);
    expect(stored).toEqual(JPEG_WITHOUT_EXIF);
  });
});
