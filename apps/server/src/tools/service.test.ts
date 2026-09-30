import { randomBytes, randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import {
  aiLimits,
  ais,
  aiTools,
  aiToolRuns,
  aiToolVersions,
  auditLog,
  groupAis,
  groupMembers,
  groups,
  providerConnections,
  topics,
} from '../db/schema';
import { createAuditRecorder } from '../audit/service';
import {
  bootstrapUser,
  createTestContext,
  testApp,
  type TestApp,
  type TestContext,
} from '../test-support';
import {
  approveToolHosts,
  deleteTool,
  deleteToolsForAiInGroup,
  deleteToolsForAiInTopic,
  getTool,
  getVersion,
  listRuns,
  listTools,
  listToolsForAi,
  listVersions,
  revertTool,
  revokeToolHosts,
  runToolVersion,
  saveToolVersion,
  ToolServiceError,
  MAX_RUNS_PER_TOOL,
  MAX_TOOLS_PER_TOPIC,
  MAX_VERSIONS_PER_TOOL,
} from './service';
import type { ToolRunResult, ToolRunner } from './types';

const NOW = new Date('2026-01-01T00:00:00Z');

async function seedAi(context: TestContext, ownerId: string): Promise<string> {
  const connectionId = randomUUID();
  await context.db.insert(providerConnections).values({
    id: connectionId,
    owner: ownerId,
    provider: 'openai',
    encryptedKey: 'sealed-placeholder',
    label: null,
  });
  const aiId = randomUUID();
  const localpart = `ai-${aiId}`;
  await context.db.insert(ais).values({
    id: aiId,
    owner: ownerId,
    name: 'Helper AI',
    template: 'dev',
    persona: 'A persona',
    providerConnectionId: connectionId,
    model: 'gpt-4o-mini',
    localpart,
    jid: `${localpart}@galena.localhost`,
    status: 'active',
  });
  await context.db.insert(aiLimits).values({ aiId, perDayUsd: '1.00', perMonthUsd: '20.00' });
  return aiId;
}

async function seedGroup(
  context: TestContext,
  ownerId: string,
  memberIds: string[],
  aiIds: string[],
): Promise<{ groupId: string; generalTopicId: string }> {
  const groupId = randomUUID();
  await context.db.insert(groups).values({
    id: groupId,
    roomLocalpart: `g${randomBytes(15).toString('hex').slice(0, 15)}`,
    title: 'Trip',
    createdBy: ownerId,
  });
  await context.db
    .insert(groupMembers)
    .values(
      [
        { userId: ownerId, role: 'owner' as const },
        ...memberIds.map((userId) => ({ userId, role: 'member' as const })),
      ].map((entry) => ({ groupId, ...entry })),
    );
  for (const aiId of aiIds) {
    await context.db.insert(groupAis).values({ groupId, aiId, addedBy: ownerId });
  }
  const generalTopicId = randomUUID();
  await context.db.insert(topics).values({
    id: generalTopicId,
    groupId,
    name: 'General',
    glyph: 'G',
    roomLocalpart: `g${randomBytes(15).toString('hex').slice(0, 15)}`,
    visibility: 'public',
    kind: 'chat',
    status: 'open',
    isGeneral: true,
    createdBy: ownerId,
  });
  return { groupId, generalTopicId };
}

async function seedTopic(
  context: TestContext,
  groupId: string,
  creatorId: string,
  name: string,
): Promise<string> {
  const topicId = randomUUID();
  await context.db.insert(topics).values({
    id: topicId,
    groupId,
    name,
    glyph: 'T',
    roomLocalpart: `g${randomBytes(15).toString('hex').slice(0, 15)}`,
    visibility: 'public',
    kind: 'chat',
    status: 'open',
    isGeneral: false,
    createdBy: creatorId,
  });
  return topicId;
}

function baseInput(overrides: Record<string, unknown> = {}) {
  return {
    name: 'morning-prices',
    description: 'Posts the price of gold, S&P 500 and BTC',
    source: 'return { text: "gold 3000" };',
    hosts: ['api.example.com'],
    message: 'First version',
    ...overrides,
  };
}

function okRunner(output = 'done'): ToolRunner & { calls: unknown[] } {
  const calls: unknown[] = [];
  const runner = (async (params: {
    source: string;
    input: unknown;
    allowedHosts: readonly string[];
  }): Promise<ToolRunResult> => {
    calls.push(params);
    return { ok: true, output: { text: output }, logs: '', durationMs: 12, fetchCount: 1 };
  }) as ToolRunner & { calls: unknown[] };
  runner.calls = calls;
  return runner;
}

describe('tools service (T-0103)', () => {
  let context: TestContext;
  let authApp: TestApp;
  let ownerId: string;
  let aiId: string;
  let emailCounter = 0;

  beforeEach(async () => {
    emailCounter += 1;
    context = await createTestContext();
    authApp = testApp(context);
    const owner = await bootstrapUser(context, authApp, `tool-owner-${emailCounter}@example.com`);
    ownerId = owner.id;
    aiId = await seedAi(context, ownerId);
  });

  afterEach(async () => {
    await context.close();
  });

  describe('saveToolVersion', () => {
    it('creates the tool with version 1', async () => {
      const { tool, version, unchanged } = await saveToolVersion(
        context.db,
        {
          aiId,
          groupId: null,
          topicId: null,
          userId: ownerId,
          ...baseInput(),
        },
        NOW,
      );
      expect(unchanged).toBe(false);
      expect(tool.currentVersion).toBe(1);
      expect(tool.source).toBe('return { text: "gold 3000" };');
      expect(version.version).toBe(1);
      expect(version.hosts).toEqual(['api.example.com']);
    });

    it('appends v2 when the source changes', async () => {
      const first = await saveToolVersion(
        context.db,
        {
          aiId,
          groupId: null,
          topicId: null,
          userId: ownerId,
          ...baseInput(),
        },
        NOW,
      );
      const second = await saveToolVersion(
        context.db,
        {
          aiId,
          groupId: null,
          topicId: null,
          userId: ownerId,
          ...baseInput({ source: 'return { text: "v2" };', message: 'Second' }),
        },
        NOW,
      );
      expect(second.unchanged).toBe(false);
      expect(second.tool.currentVersion).toBe(2);
      expect(second.version.version).toBe(2);
      expect(first.tool.id).toBe(second.tool.id);
    });

    it('an identical save returns unchanged with no new row', async () => {
      const first = await saveToolVersion(
        context.db,
        {
          aiId,
          groupId: null,
          topicId: null,
          userId: ownerId,
          ...baseInput(),
        },
        NOW,
      );
      const second = await saveToolVersion(
        context.db,
        {
          aiId,
          groupId: null,
          topicId: null,
          userId: ownerId,
          ...baseInput(),
        },
        NOW,
      );
      expect(second.unchanged).toBe(true);
      expect(second.tool.currentVersion).toBe(1);
      const versions = await listVersions(context.db, first.tool.id);
      expect(versions).toHaveLength(1);
    });

    it('a hosts change alone appends a new version', async () => {
      const first = await saveToolVersion(
        context.db,
        {
          aiId,
          groupId: null,
          topicId: null,
          userId: ownerId,
          ...baseInput(),
        },
        NOW,
      );
      const second = await saveToolVersion(
        context.db,
        {
          aiId,
          groupId: null,
          topicId: null,
          userId: ownerId,
          ...baseInput({ hosts: ['other.example.com'], message: 'Hosts only' }),
        },
        NOW,
      );
      expect(second.unchanged).toBe(false);
      expect(second.tool.currentVersion).toBe(2);
      expect(first.tool.id).toBe(second.tool.id);
    });

    it('two concurrent saves end with consecutive versions and no duplicate', async () => {
      const { tool } = await saveToolVersion(
        context.db,
        {
          aiId,
          groupId: null,
          topicId: null,
          userId: ownerId,
          ...baseInput(),
        },
        NOW,
      );
      const [a, b] = await Promise.all([
        saveToolVersion(
          context.db,
          {
            aiId,
            groupId: null,
            topicId: null,
            userId: ownerId,
            ...baseInput({ source: 'source A', message: 'A' }),
          },
          NOW,
        ),
        saveToolVersion(
          context.db,
          {
            aiId,
            groupId: null,
            topicId: null,
            userId: ownerId,
            ...baseInput({ source: 'source B', message: 'B' }),
          },
          NOW,
        ),
      ]);
      const versions = [a.version.version, b.version.version].sort();
      expect(versions).toEqual([2, 3]);
      const rows = await context.db
        .select({ version: aiToolVersions.version })
        .from(aiToolVersions)
        .where(eq(aiToolVersions.toolId, tool.id));
      expect(rows.map((row) => row.version).sort()).toEqual([1, 2, 3]);
    });

    it('the same name in a personal chat and in two topics are three tools', async () => {
      const { groupId, generalTopicId } = await seedGroup(context, ownerId, [], [aiId]);
      const otherTopicId = await seedTopic(context, groupId, ownerId, 'Other');
      const personal = await saveToolVersion(
        context.db,
        {
          aiId,
          groupId: null,
          topicId: null,
          userId: ownerId,
          ...baseInput(),
        },
        NOW,
      );
      const group = await saveToolVersion(
        context.db,
        { aiId, groupId, topicId: generalTopicId, userId: ownerId, ...baseInput() },
        NOW,
      );
      const other = await saveToolVersion(
        context.db,
        { aiId, groupId, topicId: otherTopicId, userId: ownerId, ...baseInput() },
        NOW,
      );
      expect(personal.tool.id).not.toBe(group.tool.id);
      expect(group.tool.id).not.toBe(other.tool.id);
    });

    it('a deleted name can be reused', async () => {
      const first = await saveToolVersion(
        context.db,
        {
          aiId,
          groupId: null,
          topicId: null,
          userId: ownerId,
          ...baseInput(),
        },
        NOW,
      );
      await deleteTool(context.db, first.tool.id, NOW);
      const second = await saveToolVersion(
        context.db,
        {
          aiId,
          groupId: null,
          topicId: null,
          userId: ownerId,
          ...baseInput(),
        },
        NOW,
      );
      expect(second.tool.id).not.toBe(first.tool.id);
      expect(second.tool.currentVersion).toBe(1);
    });

    it('enforces the 20-tool limit per chat', async () => {
      for (let index = 0; index < MAX_TOOLS_PER_TOPIC; index += 1) {
        await saveToolVersion(
          context.db,
          {
            aiId,
            groupId: null,
            topicId: null,
            userId: ownerId,
            ...baseInput({ name: `tool-${index}` }),
          },
          NOW,
        );
      }
      await expect(
        saveToolVersion(
          context.db,
          {
            aiId,
            groupId: null,
            topicId: null,
            userId: ownerId,
            ...baseInput({ name: 'one-too-many' }),
          },
          NOW,
        ),
      ).rejects.toMatchObject({ errorCode: 'tool_limit' });
    });

    it('enforces the 200-version limit', async () => {
      const { tool } = await saveToolVersion(
        context.db,
        {
          aiId,
          groupId: null,
          topicId: null,
          userId: ownerId,
          ...baseInput(),
        },
        NOW,
      );
      for (let version = 2; version <= MAX_VERSIONS_PER_TOOL; version += 1) {
        await saveToolVersion(
          context.db,
          {
            aiId,
            groupId: null,
            topicId: null,
            userId: ownerId,
            ...baseInput({ source: `source ${version}`, message: `v${version}` }),
          },
          NOW,
        );
      }
      await expect(
        saveToolVersion(
          context.db,
          {
            aiId,
            groupId: null,
            topicId: null,
            userId: ownerId,
            ...baseInput({ source: 'source 201', message: 'too many' }),
          },
          NOW,
        ),
      ).rejects.toMatchObject({ errorCode: 'version_limit' });
      expect(tool.id).toBeDefined();
    }, 60000);

    it.each([
      ['uppercase first', 'Morning-prices', 'invalid_request'],
      ['single char', 'a', 'invalid_request'],
      ['spaces', 'morning prices', 'invalid_request'],
      ['too long', `t${'o'.repeat(40)}`, 'invalid_request'],
    ])('rejects name %s', async (_label, name, code) => {
      await expect(
        saveToolVersion(
          context.db,
          {
            aiId,
            groupId: null,
            topicId: null,
            userId: ownerId,
            ...baseInput({ name }),
          },
          NOW,
        ),
      ).rejects.toMatchObject({ errorCode: code });
    });

    it('rejects an empty description and one with control characters', async () => {
      await expect(
        saveToolVersion(
          context.db,
          {
            aiId,
            groupId: null,
            topicId: null,
            userId: ownerId,
            ...baseInput({ description: '' }),
          },
          NOW,
        ),
      ).rejects.toMatchObject({ errorCode: 'invalid_request' });
      await expect(
        saveToolVersion(
          context.db,
          {
            aiId,
            groupId: null,
            topicId: null,
            userId: ownerId,
            ...baseInput({ description: 'line one\nline two' }),
          },
          NOW,
        ),
      ).rejects.toMatchObject({ errorCode: 'invalid_request' });
    });

    it.each([
      ['IP literal', ['127.0.0.1']],
      ['wildcard', ['*.example.com']],
      ['port', ['example.com:8080']],
      ['scheme', ['https://example.com']],
      ['path', ['example.com/path']],
      ['no dot', ['localhost']],
      [
        'six hosts',
        [
          'a.example.com',
          'b.example.com',
          'c.example.com',
          'd.example.com',
          'e.example.com',
          'f.example.com',
        ],
      ],
    ])('rejects hosts %s', async (_label, hosts) => {
      await expect(
        saveToolVersion(
          context.db,
          {
            aiId,
            groupId: null,
            topicId: null,
            userId: ownerId,
            ...baseInput({ hosts }),
          },
          NOW,
        ),
      ).rejects.toMatchObject({ errorCode: 'invalid_request' });
    });

    it('normalises uppercase hosts to lowercase and de-duplicates', async () => {
      const { tool } = await saveToolVersion(
        context.db,
        {
          aiId,
          groupId: null,
          topicId: null,
          userId: ownerId,
          ...baseInput({ hosts: ['API.Example.COM', 'api.example.com'] }),
        },
        NOW,
      );
      expect(tool.hosts).toEqual(['api.example.com']);
    });

    it('rejects an empty and an oversized source', async () => {
      await expect(
        saveToolVersion(
          context.db,
          {
            aiId,
            groupId: null,
            topicId: null,
            userId: ownerId,
            ...baseInput({ source: '' }),
          },
          NOW,
        ),
      ).rejects.toMatchObject({ errorCode: 'invalid_request' });
      await expect(
        saveToolVersion(
          context.db,
          {
            aiId,
            groupId: null,
            topicId: null,
            userId: ownerId,
            ...baseInput({ source: `x${'y'.repeat(65 * 1024)}` }),
          },
          NOW,
        ),
      ).rejects.toMatchObject({ errorCode: 'invalid_request' });
    });
  });

  describe('list/get/versions', () => {
    it('listTools has no source but has hosts and last run status', async () => {
      const { tool } = await saveToolVersion(
        context.db,
        {
          aiId,
          groupId: null,
          topicId: null,
          userId: ownerId,
          ...baseInput(),
        },
        NOW,
      );
      const before = await listTools(context.db, { aiId, groupId: null, topicId: null });
      expect(before[0]).not.toHaveProperty('source');
      expect(before[0]?.hosts).toEqual(['api.example.com']);
      expect(before[0]?.lastRunStatus).toBeNull();
      const runner = okRunner();
      await runToolVersion({ db: context.db, runner }, { toolId: tool.id, trigger: 'manual' }, NOW);
      const after = await listTools(context.db, { aiId, groupId: null, topicId: null });
      expect(after[0]?.lastRunStatus).toBe('ok');
    });

    it('getTool returns the current source; listVersions has no source', async () => {
      const { tool } = await saveToolVersion(
        context.db,
        {
          aiId,
          groupId: null,
          topicId: null,
          userId: ownerId,
          ...baseInput(),
        },
        NOW,
      );
      const detail = await getTool(context.db, tool.id);
      expect(detail?.source).toBe('return { text: "gold 3000" };');
      const versions = await listVersions(context.db, tool.id);
      expect(versions?.[0]).not.toHaveProperty('source');
      const one = await getVersion(context.db, tool.id, 1);
      expect(one?.source).toBe('return { text: "gold 3000" };');
    });

    it('listToolsForAi annotates the scope', async () => {
      const { groupId, generalTopicId } = await seedGroup(context, ownerId, [], [aiId]);
      await saveToolVersion(
        context.db,
        {
          aiId,
          groupId: null,
          topicId: null,
          userId: ownerId,
          ...baseInput({ name: 'personal-one' }),
        },
        NOW,
      );
      await saveToolVersion(
        context.db,
        {
          aiId,
          groupId,
          topicId: generalTopicId,
          userId: ownerId,
          ...baseInput({ name: 'group-one' }),
        },
        NOW,
      );
      const tools = await listToolsForAi(context.db, aiId);
      expect(tools.map((tool) => [tool.name, tool.scope]).sort()).toEqual([
        ['group-one', 'group'],
        ['personal-one', 'personal'],
      ]);
    });
  });

  describe('revertTool', () => {
    it('appends a new version with the old content and the standard message', async () => {
      const { tool } = await saveToolVersion(
        context.db,
        {
          aiId,
          groupId: null,
          topicId: null,
          userId: ownerId,
          ...baseInput(),
        },
        NOW,
      );
      await saveToolVersion(
        context.db,
        {
          aiId,
          groupId: null,
          topicId: null,
          userId: ownerId,
          ...baseInput({
            source: 'bad change',
            hosts: ['bad.example.com'],
            message: 'A bad change',
          }),
        },
        NOW,
      );
      const before = await listVersions(context.db, tool.id);
      const { version } = await revertTool(
        context.db,
        { toolId: tool.id, toVersion: 1, userId: ownerId },
        NOW,
      );
      expect(version.version).toBe(3);
      expect(version.message).toBe('Revert to v1');
      expect(version.source).toBe('return { text: "gold 3000" };');
      expect(version.hosts).toEqual(['api.example.com']);
      const after = await listVersions(context.db, tool.id);
      expect(after).toHaveLength(3);
      expect(before?.map((row) => row.version)).toEqual([2, 1]);
      expect(after?.map((row) => row.version)).toEqual([3, 2, 1]);
    });

    it('accepts a custom message and rejects an unknown version', async () => {
      const { tool } = await saveToolVersion(
        context.db,
        {
          aiId,
          groupId: null,
          topicId: null,
          userId: ownerId,
          ...baseInput(),
        },
        NOW,
      );
      const { version } = await revertTool(
        context.db,
        { toolId: tool.id, toVersion: 1, userId: ownerId, message: 'Back to the good one' },
        NOW,
      );
      expect(version.message).toBe('Back to the good one');
      await expect(
        revertTool(context.db, { toolId: tool.id, toVersion: 99, userId: ownerId }, NOW),
      ).rejects.toMatchObject({ errorCode: 'not_found' });
    });

    it('history rows are never modified by revert or delete', async () => {
      const { tool } = await saveToolVersion(
        context.db,
        {
          aiId,
          groupId: null,
          topicId: null,
          userId: ownerId,
          ...baseInput(),
        },
        NOW,
      );
      await saveToolVersion(
        context.db,
        {
          aiId,
          groupId: null,
          topicId: null,
          userId: ownerId,
          ...baseInput({ source: 'v2 source', message: 'v2' }),
        },
        NOW,
      );
      const versionsBefore = await context.db
        .select()
        .from(aiToolVersions)
        .where(eq(aiToolVersions.toolId, tool.id));
      const toolsBefore = await context.db.select().from(aiTools).where(eq(aiTools.id, tool.id));
      await revertTool(context.db, { toolId: tool.id, toVersion: 1, userId: ownerId }, NOW);
      const versionsAfterRevert = await context.db
        .select()
        .from(aiToolVersions)
        .where(eq(aiToolVersions.toolId, tool.id));
      for (const before of versionsBefore) {
        const after = versionsAfterRevert.find((row) => row.id === before.id);
        expect(after).toEqual(before);
      }
      await deleteTool(context.db, tool.id, NOW);
      const versionsAfterDelete = await context.db
        .select()
        .from(aiToolVersions)
        .where(eq(aiToolVersions.toolId, tool.id));
      expect(versionsAfterDelete).toHaveLength(versionsAfterRevert.length);
      for (const before of versionsAfterRevert) {
        const after = versionsAfterDelete.find((row) => row.id === before.id);
        expect(after).toEqual(before);
      }
      expect(toolsBefore).toHaveLength(1);
    });
  });

  describe('deleteToolsForAiInGroup', () => {
    it('soft-deletes that AI group tools only', async () => {
      const { groupId, generalTopicId } = await seedGroup(context, ownerId, [], [aiId]);
      const other = await seedGroup(context, ownerId, [], [aiId]);
      const groupTool = await saveToolVersion(
        context.db,
        {
          aiId,
          groupId,
          topicId: generalTopicId,
          userId: ownerId,
          ...baseInput({ name: 'group-tool' }),
        },
        NOW,
      );
      const personalTool = await saveToolVersion(
        context.db,
        {
          aiId,
          groupId: null,
          topicId: null,
          userId: ownerId,
          ...baseInput({ name: 'personal-tool' }),
        },
        NOW,
      );
      const otherTool = await saveToolVersion(
        context.db,
        {
          aiId,
          groupId: other.groupId,
          topicId: other.generalTopicId,
          userId: ownerId,
          ...baseInput({ name: 'other-tool' }),
        },
        NOW,
      );
      const deleted = await context.db.transaction(async (rawTx) =>
        deleteToolsForAiInGroup(rawTx as unknown as typeof context.db, {
          aiId,
          groupId,
          now: NOW,
        }),
      );
      expect(deleted).toEqual([groupTool.tool.id]);
      expect(await getTool(context.db, groupTool.tool.id)).toBeNull();
      expect(await getTool(context.db, personalTool.tool.id)).not.toBeNull();
      expect(await getTool(context.db, otherTool.tool.id)).not.toBeNull();
    });

    it('deleteToolsForAiInTopic soft-deletes only that topic tools', async () => {
      const { groupId, generalTopicId } = await seedGroup(context, ownerId, [], [aiId]);
      const otherTopicId = await seedTopic(context, groupId, ownerId, 'Other');
      const generalTool = await saveToolVersion(
        context.db,
        {
          aiId,
          groupId,
          topicId: generalTopicId,
          userId: ownerId,
          ...baseInput({ name: 'general-tool' }),
        },
        NOW,
      );
      const otherTool = await saveToolVersion(
        context.db,
        {
          aiId,
          groupId,
          topicId: otherTopicId,
          userId: ownerId,
          ...baseInput({ name: 'other-tool' }),
        },
        NOW,
      );
      const deleted = await context.db.transaction(async (rawTx) =>
        deleteToolsForAiInTopic(rawTx as unknown as typeof context.db, {
          aiId,
          topicId: otherTopicId,
          now: NOW,
        }),
      );
      expect(deleted).toEqual([otherTool.tool.id]);
      expect(await getTool(context.db, otherTool.tool.id)).toBeNull();
      expect(await getTool(context.db, generalTool.tool.id)).not.toBeNull();
    });
  });

  describe('runToolVersion', () => {
    it('the runner receives the chosen version source and the approved-hosts intersection', async () => {
      const { tool } = await saveToolVersion(
        context.db,
        {
          aiId,
          groupId: null,
          topicId: null,
          userId: ownerId,
          ...baseInput(),
        },
        NOW,
      );
      await saveToolVersion(
        context.db,
        {
          aiId,
          groupId: null,
          topicId: null,
          userId: ownerId,
          ...baseInput({
            source: 'v2 source',
            hosts: ['v2.example.com'],
            message: 'v2',
          }),
        },
        NOW,
      );
      // T-0132: nothing approved yet, so the runner sees the empty
      // intersection even though v1 declares api.example.com.
      const runner = okRunner();
      await runToolVersion(
        { db: context.db, runner },
        { toolId: tool.id, version: 1, input: { day: 'today' }, trigger: 'manual' },
        NOW,
      );
      expect(runner.calls).toHaveLength(1);
      expect(runner.calls[0]).toEqual({
        source: 'return { text: "gold 3000" };',
        input: { day: 'today' },
        allowedHosts: [],
      });
      await approveToolHosts(
        context.db,
        { toolId: tool.id, hosts: ['api.example.com'], userId: ownerId },
        NOW,
      );
      const afterApproval = okRunner();
      await runToolVersion(
        { db: context.db, runner: afterApproval },
        { toolId: tool.id, version: 1, input: { day: 'today' }, trigger: 'manual' },
        NOW,
      );
      expect(afterApproval.calls[0]).toEqual({
        source: 'return { text: "gold 3000" };',
        input: { day: 'today' },
        allowedHosts: ['api.example.com'],
      });
    });

    it('passes only declared ∩ approved hosts for every trigger', async () => {
      const { tool } = await saveToolVersion(
        context.db,
        {
          aiId,
          groupId: null,
          topicId: null,
          userId: ownerId,
          ...baseInput({ hosts: ['api.example.com', 'other.example.com'] }),
        },
        NOW,
      );
      await approveToolHosts(
        context.db,
        { toolId: tool.id, hosts: ['api.example.com'], userId: ownerId },
        NOW,
      );
      for (const trigger of ['manual', 'routine', 'ai'] as const) {
        const runner = okRunner();
        await runToolVersion({ db: context.db, runner }, { toolId: tool.id, trigger }, NOW);
        expect(runner.calls[0]).toEqual({
          source: expect.any(String),
          input: null,
          allowedHosts: ['api.example.com'],
        });
      }
      // A tool with no approval still runs, with no network.
      await revokeToolHosts(context.db, { toolId: tool.id, userId: ownerId }, NOW);
      const offline = okRunner();
      await runToolVersion(
        { db: context.db, runner: offline },
        { toolId: tool.id, trigger: 'ai' },
        NOW,
      );
      expect(offline.calls[0]).toMatchObject({ allowedHosts: [] });
    });

    it('approve and revoke write audited id-only entries, never code or output', async () => {
      const audit = createAuditRecorder({ db: context.db, now: () => NOW });
      const source = 'return { text: "SECRET-SOURCE-DO-NOT-LOG" };';
      const { tool } = await saveToolVersion(
        context.db,
        {
          aiId,
          groupId: null,
          topicId: null,
          userId: ownerId,
          ...baseInput({ source }),
        },
        NOW,
        audit,
      );
      const approved = await approveToolHosts(
        context.db,
        { toolId: tool.id, hosts: ['api.example.com'], userId: ownerId },
        NOW,
        audit,
      );
      expect(approved.approvedHosts).toEqual(['api.example.com']);
      const revoked = await revokeToolHosts(
        context.db,
        { toolId: tool.id, userId: ownerId },
        NOW,
        audit,
      );
      expect(revoked.approvedHosts).toEqual([]);
      const listed = await listTools(context.db, { aiId, groupId: null, topicId: null });
      expect(listed[0]?.approvedHosts).toEqual([]);
      const rows = await context.db.select().from(auditLog);
      expect(rows.find((row) => row.action === 'tool.hosts_approved')?.detail).toEqual({
        name: 'morning-prices',
        version: 1,
        hosts: ['api.example.com'],
      });
      expect(rows.find((row) => row.action === 'tool.hosts_revoked')?.detail).toEqual({
        name: 'morning-prices',
      });
      expect(JSON.stringify(rows)).not.toContain('SECRET-SOURCE-DO-NOT-LOG');
    });

    it('defaults to the current version and writes a run row', async () => {
      const { tool } = await saveToolVersion(
        context.db,
        {
          aiId,
          groupId: null,
          topicId: null,
          userId: ownerId,
          ...baseInput(),
        },
        NOW,
      );
      const runner = okRunner('hello world');
      const { result, run } = await runToolVersion(
        { db: context.db, runner },
        { toolId: tool.id, trigger: 'manual' },
        NOW,
      );
      expect(result.ok).toBe(true);
      expect(run.status).toBe('ok');
      expect(run.version).toBe(1);
      expect(run.outputText).toBe('hello world');
      const runs = await listRuns(context.db, tool.id);
      expect(runs).toHaveLength(1);
    });

    it('prunes runs to the newest 50', async () => {
      const { tool } = await saveToolVersion(
        context.db,
        {
          aiId,
          groupId: null,
          topicId: null,
          userId: ownerId,
          ...baseInput(),
        },
        NOW,
      );
      const runner = okRunner();
      for (let index = 0; index < MAX_RUNS_PER_TOOL + 5; index += 1) {
        await runToolVersion(
          { db: context.db, runner },
          { toolId: tool.id, trigger: 'manual' },
          new Date(NOW.getTime() + index * 1000),
        );
      }
      const runs = await context.db
        .select({ id: aiToolRuns.id })
        .from(aiToolRuns)
        .where(eq(aiToolRuns.toolId, tool.id));
      expect(runs).toHaveLength(MAX_RUNS_PER_TOOL);
    }, 60000);

    it('truncates long output to 2 KiB in the row', async () => {
      const { tool } = await saveToolVersion(
        context.db,
        {
          aiId,
          groupId: null,
          topicId: null,
          userId: ownerId,
          ...baseInput(),
        },
        NOW,
      );
      const runner = okRunner(`x${'y'.repeat(3000)}`);
      const { run } = await runToolVersion(
        { db: context.db, runner },
        { toolId: tool.id, trigger: 'manual' },
        NOW,
      );
      expect(run.outputText).not.toBeNull();
      expect(Buffer.byteLength(run.outputText ?? '', 'utf8')).toBeLessThanOrEqual(2 * 1024);
    });

    it('a stopped AI throws ai_not_active and the runner is not called', async () => {
      const { tool } = await saveToolVersion(
        context.db,
        {
          aiId,
          groupId: null,
          topicId: null,
          userId: ownerId,
          ...baseInput(),
        },
        NOW,
      );
      await context.db.update(ais).set({ status: 'stopped' }).where(eq(ais.id, aiId));
      const runner = okRunner();
      await expect(
        runToolVersion({ db: context.db, runner }, { toolId: tool.id, trigger: 'manual' }, NOW),
      ).rejects.toMatchObject({ errorCode: 'ai_not_active' });
      expect(runner.calls).toHaveLength(0);
      const runs = await context.db
        .select({ id: aiToolRuns.id })
        .from(aiToolRuns)
        .where(eq(aiToolRuns.toolId, tool.id));
      expect(runs).toHaveLength(0);
    });

    it('a provisioning AI also throws ai_not_active', async () => {
      const { tool } = await saveToolVersion(
        context.db,
        {
          aiId,
          groupId: null,
          topicId: null,
          userId: ownerId,
          ...baseInput(),
        },
        NOW,
      );
      await context.db.update(ais).set({ status: 'disabled' }).where(eq(ais.id, aiId));
      const runner = okRunner();
      await expect(
        runToolVersion({ db: context.db, runner }, { toolId: tool.id, trigger: 'manual' }, NOW),
      ).rejects.toMatchObject({ errorCode: 'ai_not_active' });
      expect(runner.calls).toHaveLength(0);
    });

    it('a runner failure is recorded as error with its kind and does not throw', async () => {
      const { tool } = await saveToolVersion(
        context.db,
        {
          aiId,
          groupId: null,
          topicId: null,
          userId: ownerId,
          ...baseInput(),
        },
        NOW,
      );
      const failing: ToolRunner = () =>
        Promise.resolve({
          ok: false,
          error: { kind: 'timeout', message: 'took too long' },
          logs: 'logs here',
          durationMs: 5000,
          fetchCount: 0,
        });
      const { result, run } = await runToolVersion(
        { db: context.db, runner: failing },
        { toolId: tool.id, trigger: 'manual' },
        NOW,
      );
      expect(result.ok).toBe(false);
      expect(run.status).toBe('error');
      expect(run.errorKind).toBe('timeout');
    });

    it('run rows are never modified by later runs or deletes', async () => {
      const { tool } = await saveToolVersion(
        context.db,
        {
          aiId,
          groupId: null,
          topicId: null,
          userId: ownerId,
          ...baseInput(),
        },
        NOW,
      );
      const runner = okRunner('first');
      await runToolVersion({ db: context.db, runner }, { toolId: tool.id, trigger: 'manual' }, NOW);
      const before = await context.db
        .select()
        .from(aiToolRuns)
        .where(eq(aiToolRuns.toolId, tool.id));
      const second = okRunner('second');
      await runToolVersion(
        { db: context.db, runner: second },
        { toolId: tool.id, trigger: 'manual' },
        new Date(NOW.getTime() + 1000),
      );
      const after = await context.db
        .select()
        .from(aiToolRuns)
        .where(eq(aiToolRuns.toolId, tool.id));
      for (const row of before) {
        expect(after.find((candidate) => candidate.id === row.id)).toEqual(row);
      }
    });
  });

  describe('deleteTool', () => {
    it('soft-deletes and is idempotent', async () => {
      const { tool } = await saveToolVersion(
        context.db,
        {
          aiId,
          groupId: null,
          topicId: null,
          userId: ownerId,
          ...baseInput(),
        },
        NOW,
      );
      expect(await deleteTool(context.db, tool.id, NOW)).toEqual({ deleted: true });
      expect(await getTool(context.db, tool.id)).toBeNull();
      expect(await deleteTool(context.db, tool.id, NOW)).toEqual({ deleted: false });
      expect(await deleteTool(context.db, 'no-such-tool', NOW)).toEqual({ deleted: false });
      const [row] = await context.db.select().from(aiTools).where(eq(aiTools.id, tool.id));
      expect(row?.deletedAt).not.toBeNull();
    });
  });

  describe('audit', () => {
    it('writes tool.created and tool.updated with name and version, never source', async () => {
      const audit = createAuditRecorder({ db: context.db, now: () => NOW });
      const first = await saveToolVersion(
        context.db,
        {
          aiId,
          groupId: null,
          topicId: null,
          userId: ownerId,
          ...baseInput(),
        },
        NOW,
        audit,
      );
      expect(first.created).toBe(true);
      const second = await saveToolVersion(
        context.db,
        {
          aiId,
          groupId: null,
          topicId: null,
          userId: ownerId,
          ...baseInput({ source: 'changed source', message: 'v2' }),
        },
        NOW,
        audit,
      );
      expect(second.created).toBe(false);
      const identical = await saveToolVersion(
        context.db,
        {
          aiId,
          groupId: null,
          topicId: null,
          userId: ownerId,
          ...baseInput({ source: 'changed source', message: 'v2' }),
        },
        NOW,
        audit,
      );
      expect(identical.unchanged).toBe(true);
      const rows = await context.db.select().from(auditLog);
      const created = rows.find((row) => row.action === 'tool.created');
      const updated = rows.find((row) => row.action === 'tool.updated');
      expect(created?.subjectId).toBe(first.tool.id);
      expect(created?.actorUserId).toBe(ownerId);
      expect(created?.aiId).toBe(aiId);
      expect(created?.detail).toEqual({ name: 'morning-prices', version: 1 });
      expect(updated?.detail).toEqual({ name: 'morning-prices', version: 2 });
      expect(rows.filter((row) => row.action === 'tool.updated')).toHaveLength(1);
      for (const row of rows) {
        expect(JSON.stringify(row.detail)).not.toContain('changed source');
        expect(JSON.stringify(row.detail)).not.toContain('gold 3000');
      }
    });
  });

  describe('errors', () => {
    it('ToolServiceError carries its code', () => {
      const error = new ToolServiceError('ai_not_active', 'The AI is not active');
      expect(error.errorCode).toBe('ai_not_active');
      expect(error).toBeInstanceOf(Error);
    });
    it('getTool/getVersion/listVersions/listRuns return null for unknown tools', async () => {
      expect(await getTool(context.db, 'no-such-tool')).toBeNull();
      expect(await getVersion(context.db, 'no-such-tool', 1)).toBeNull();
      expect(await listVersions(context.db, 'no-such-tool')).toBeNull();
      expect(await listRuns(context.db, 'no-such-tool')).toBeNull();
    });
  });
});
