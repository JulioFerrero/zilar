// T-1498: approvals carry the AI and group display names. One test covers the
// list's wire shape (a group approval names its AI and group, a DM has no
// group name), the other the batching: two names cost two queries, never one
// per row.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as sqlModule from '../effect/sql';
import {
  bootstrapUser,
  createTestContext,
  testApp,
  TEST_BASE_URL,
  type TestApp,
  type TestContext,
} from '../test-support';
import { seedAi, seedGroup } from '../test-support/seed';
import { approvalNames, namesForApproval } from './api';
import { createApproval } from './service';

describe('approval names (T-1498)', () => {
  let context: TestContext;
  let app: TestApp;

  beforeEach(async () => {
    context = await createTestContext();
    app = testApp(context);
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await context.close();
  });

  it('the list carries the AI name and the group name, or null for a DM', async () => {
    const owner = await bootstrapUser(context, app, 'owner@example.com');
    const { aiId } = await seedAi(context, owner.id, { name: 'Dev-1' });
    const { groupId, generalTopicId } = await seedGroup(
      context,
      owner.id,
      [{ userId: owner.id, role: 'owner' }],
      [aiId],
      { title: 'Dev team' },
    );

    const groupApproval = await createApproval(
      context.db,
      {
        aiId,
        groupId,
        topicId: generalTopicId,
        action: 'merge_pull_request',
        summary: 'Merge the PR raised in the group topic',
        argsHash: 'a'.repeat(64),
        requestedBy: 'ai-dev-1@zilar.test',
        expiresAt: new Date(Date.now() + 60_000),
      },
      new Date(),
    );
    const dmApproval = await createApproval(
      context.db,
      {
        aiId,
        action: 'merge_pull_request',
        summary: 'Merge the PR raised in the DM',
        argsHash: 'b'.repeat(64),
        requestedBy: 'ai-dev-1@zilar.test',
        expiresAt: new Date(Date.now() + 60_000),
      },
      new Date(),
    );

    const response = await app.request(`${TEST_BASE_URL}/api/approvals`, {
      headers: { cookie: owner.cookie },
    });
    expect(response.status).toBe(200);
    const rows = (await response.json()) as Array<{
      id: string;
      aiName: string;
      groupName: string | null;
    }>;

    const group = rows.find((row) => row.id === groupApproval.id);
    expect(group?.aiName).toBe('Dev-1');
    expect(group?.groupName).toBe('Dev team');

    const dm = rows.find((row) => row.id === dmApproval.id);
    expect(dm?.aiName).toBe('Dev-1');
    expect(dm?.groupName).toBeNull();
  });

  it('resolves the names with one query per table, not one per row', async () => {
    const owner = await bootstrapUser(context, app, 'owner@example.com');
    const first = await seedAi(context, owner.id, { name: 'Dev-1' });
    const second = await seedAi(context, owner.id, { name: 'Dev-2' });
    const firstGroup = await seedGroup(
      context,
      owner.id,
      [{ userId: owner.id, role: 'owner' }],
      [first.aiId],
      { title: 'Dev team' },
    );
    const secondGroup = await seedGroup(
      context,
      owner.id,
      [{ userId: owner.id, role: 'owner' }],
      [second.aiId],
      { title: 'Ops team' },
    );

    const runSql = vi.spyOn(sqlModule, 'runSql');
    const names = await approvalNames(context.db, [
      { aiId: first.aiId, groupId: firstGroup.groupId },
      { aiId: second.aiId, groupId: secondGroup.groupId },
    ]);

    // Two rows, two AIs and two groups: still one AI query and one group query.
    expect(runSql).toHaveBeenCalledTimes(2);
    expect(namesForApproval(names, { aiId: first.aiId, groupId: firstGroup.groupId })).toEqual({
      aiName: 'Dev-1',
      groupName: 'Dev team',
    });
    expect(namesForApproval(names, { aiId: second.aiId, groupId: null })).toEqual({
      aiName: 'Dev-2',
      groupName: null,
    });
  });
});
