import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Effect } from 'effect';
import { SqlClient } from 'effect/sql';
import { createTestContext, testSql, type TestContext } from '../test-support';
import { seedAi, seedUser } from '../test-support/seed';
import {
  CARD_MEDIA_DAILY_MAX,
  CardMediaQuotaError,
  cardMediaPath,
  getCardMedia,
  storeCardMedia,
} from './service';

describe('card media service', () => {
  let context: TestContext;
  let dir: string;

  beforeEach(async () => {
    context = await createTestContext();
    dir = await mkdtemp(join(tmpdir(), 'zilar-card-media-'));
  });

  afterEach(async () => {
    await context.close();
    await rm(dir, { recursive: true, force: true });
  });

  it('admits only one upload when two race for the last daily slot', async () => {
    const ownerId = await seedUser(context);
    const { aiId } = await seedAi(context, ownerId);
    const base = {
      aiId,
      roomJid: 'room@rooms.zilar.localhost',
      mime: 'image/png',
      name: 'card.png',
    };
    for (let index = 0; index < CARD_MEDIA_DAILY_MAX - 1; index += 1) {
      await storeCardMedia(context.db, dir, {
        ...base,
        name: `card-${index}.png`,
        bytes: new Uint8Array([1]),
      });
    }

    // One slot left. Both uploads run at once: the per-AI advisory lock
    // serializes them, so exactly one wins and the loser is refused with the
    // typed quota error — never two rows over the cap.
    const outcomes = await Promise.allSettled([
      storeCardMedia(context.db, dir, { ...base, bytes: new Uint8Array([2]) }),
      storeCardMedia(context.db, dir, { ...base, bytes: new Uint8Array([3]) }),
    ]);

    const winners = outcomes.filter((outcome) => outcome.status === 'fulfilled');
    const losers = outcomes.filter((outcome) => outcome.status === 'rejected');
    expect(winners).toHaveLength(1);
    expect(losers).toHaveLength(1);
    const [loser] = losers;
    if (loser?.status === 'rejected') {
      expect(loser.reason).toBeInstanceOf(CardMediaQuotaError);
      expect((loser.reason as CardMediaQuotaError).reason).toBe('daily');
    }

    const [countRow] = await testSql(context)(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        return yield* sql<{ total: number }>`SELECT count(*)::int AS total FROM card_media
          WHERE ai_id = ${aiId}`;
      }),
    );
    expect(countRow?.total).toBe(CARD_MEDIA_DAILY_MAX);
    // The refused upload wrote no file either.
    expect(await readdir(dir)).toHaveLength(CARD_MEDIA_DAILY_MAX);

    const [winner] = winners;
    if (winner?.status === 'fulfilled') {
      const stored = await getCardMedia(context.db, winner.value.id);
      expect(stored?.storageKey).toBe(winner.value.storageKey);
      expect((await readFile(cardMediaPath(dir, winner.value))).byteLength).toBe(1);
    }
  });
});
