import { describe, expect, it } from 'vitest';
import { createHealthCheck, markDraining, markLeader } from './health';
import { createTestContext } from './test-support';

describe('/health', () => {
  it('answers 503 with draining true while draining, and reports the leader flag', async () => {
    const context = await createTestContext();
    try {
      markLeader(true);
      markDraining();
      const health = createHealthCheck({ db: context.db, adminClient: context.adminClient });

      const result = await health();

      expect(result.status).toBe(503);
      expect(result.body).toMatchObject({ ok: false, db: 'ok', leader: true, draining: true });
    } finally {
      await context.close();
    }
  });
});
