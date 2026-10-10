import { randomBytes, randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Effect } from 'effect';
import { SqlClient } from 'effect/sql';
import { pino } from 'pino';
import { createAuditRecorder } from '../audit/service';
import {
  bootstrapUser,
  createTestContext,
  testApp,
  testSql,
  TEST_BASE_URL,
  type TestApp,
  type TestContext,
} from '../test-support';
import { seedAi, seedGroup } from '../test-support/seed';
import { createToolsApi, TOOL_RUN_RATE_LIMIT_MAX } from './api';
import { saveToolVersion } from './service';
import type { ToolRunResult, ToolRunner } from './types';

const NOW = new Date('2026-01-01T00:00:00Z');

interface AuditRow {
  action: string;
  detail: unknown;
}

function fakeRunner(output = 'ok output'): ToolRunner {
  return () =>
    Promise.resolve({
      ok: true,
      output: { text: output },
      logs: '',
      durationMs: 9,
      fetchCount: 0,
    } satisfies ToolRunResult);
}

function buildRoutesHarness(
  context: TestContext,
  options: { toolRunner?: ToolRunner; now?: () => number } = {},
) {
  const audit = createAuditRecorder({ db: context.db, now: () => NOW });
  const api = createToolsApi({
    auth: context.auth,
    db: context.db,
    logger: pino({ level: 'silent' }),
    audit,
    ...(options.toolRunner === undefined ? {} : { toolRunner: options.toolRunner }),
    ...(options.now === undefined ? {} : { now: options.now }),
  });
  return {
    request(url: string, init?: RequestInit): Promise<Response> {
      return api.handler(new Request(url, init));
    },
  };
}

async function seedTool(
  context: TestContext,
  args: {
    aiId: string;
    groupId: string | null;
    topicId: string | null;
    userId: string;
    name?: string;
  },
): Promise<string> {
  const { tool } = await saveToolVersion(
    context.db,
    {
      aiId: args.aiId,
      groupId: args.groupId,
      topicId: args.topicId,
      name: args.name ?? 'morning-prices',
      description: 'Posts the price of gold, S&P 500 and BTC',
      source: 'return { text: "gold 3000" };',
      hosts: ['api.example.com'],
      message: 'First version',
      userId: args.userId,
    },
    NOW,
  );
  return tool.id;
}

async function errorCodeOf(response: Response): Promise<string> {
  const body = (await response.json()) as { error: { code: string } };
  return body.error.code;
}

describe('tools routes (T-0103)', () => {
  let context: TestContext;
  let authApp: TestApp;
  let app: ReturnType<typeof buildRoutesHarness>;
  let emailCounter = 0;

  beforeEach(async () => {
    emailCounter += 1;
    context = await createTestContext();
    authApp = testApp(context);
    app = buildRoutesHarness(context, { toolRunner: fakeRunner() });
  });

  afterEach(async () => {
    await context.close();
  });

  async function ownerWithAi(email: string): Promise<{ cookie: string; id: string; aiId: string }> {
    const owner = await bootstrapUser(context, authApp, email);
    const { aiId } = await seedAi(context, owner.id);
    return { cookie: owner.cookie, id: owner.id, aiId };
  }

  describe('auth', () => {
    it('returns 401 without a session on every route', async () => {
      const paths: Array<{ method: string; path: string; body?: unknown }> = [
        { method: 'GET', path: '/api/ais/x/tools' },
        { method: 'GET', path: '/api/groups/x/tools' },
        { method: 'GET', path: '/api/topics/x/tools' },
        { method: 'GET', path: '/api/tools/x' },
        { method: 'GET', path: '/api/tools/x/versions' },
        { method: 'GET', path: '/api/tools/x/versions/1' },
        { method: 'GET', path: '/api/tools/x/runs' },
        { method: 'POST', path: '/api/tools/x/revert', body: { version: 1 } },
        { method: 'DELETE', path: '/api/tools/x' },
        { method: 'POST', path: '/api/tools/x/run', body: {} },
      ];
      for (const entry of paths) {
        const response = await app.request(`${TEST_BASE_URL}${entry.path}`, {
          method: entry.method,
          ...(entry.body === undefined
            ? {}
            : {
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify(entry.body),
              }),
        });
        expect(response.status, `${entry.method} ${entry.path}`).toBe(401);
      }
    });
  });

  describe('GET /api/ais/:id/tools', () => {
    it('the owner lists every chat tools with scope', async () => {
      const owner = await ownerWithAi(`routes-owner-${emailCounter}@example.com`);
      const { groupId, generalTopicId } = await seedGroup(
        context,
        owner.id,
        [{ userId: owner.id, role: 'owner' }],
        [owner.aiId],
      );
      await seedTool(context, { aiId: owner.aiId, groupId: null, topicId: null, userId: owner.id });
      await seedTool(context, {
        aiId: owner.aiId,
        groupId,
        topicId: generalTopicId,
        userId: owner.id,
        name: 'group-tool',
      });
      const response = await app.request(`${TEST_BASE_URL}/api/ais/${owner.aiId}/tools`, {
        headers: { cookie: owner.cookie },
      });
      expect(response.status).toBe(200);
      const tools = (await response.json()) as Array<{
        name: string;
        scope: string;
        groupId: string | null;
      }>;
      expect(tools.map((tool) => [tool.name, tool.scope]).sort()).toEqual([
        ['group-tool', 'group'],
        ['morning-prices', 'personal'],
      ]);
      expect(tools.find((tool) => tool.scope === 'group')?.groupId).toBe(groupId);
    });

    it('a stranger gets 404, same as a missing AI', async () => {
      const owner = await ownerWithAi(`routes-owner2-${emailCounter}@example.com`);
      const stranger = await bootstrapUser(
        context,
        authApp,
        `routes-stranger-${emailCounter}@example.com`,
      );
      const strangerResponse = await app.request(`${TEST_BASE_URL}/api/ais/${owner.aiId}/tools`, {
        headers: { cookie: stranger.cookie },
      });
      expect(strangerResponse.status).toBe(404);
      const missing = await app.request(`${TEST_BASE_URL}/api/ais/no-such-ai/tools`, {
        headers: { cookie: owner.cookie },
      });
      expect(missing.status).toBe(404);
    });
  });

  describe('GET /api/groups/:id/tools', () => {
    it('any member lists the group tools; a stranger gets 404', async () => {
      const owner = await ownerWithAi(`g-owner-${emailCounter}@example.com`);
      const member = await bootstrapUser(context, authApp, `g-member-${emailCounter}@example.com`);
      const stranger = await bootstrapUser(
        context,
        authApp,
        `g-stranger-${emailCounter}@example.com`,
      );
      const { groupId, generalTopicId } = await seedGroup(
        context,
        owner.id,
        [
          { userId: owner.id, role: 'owner' },
          { userId: member.id, role: 'member' },
        ],
        [owner.aiId],
      );
      await seedTool(context, {
        aiId: owner.aiId,
        groupId,
        topicId: generalTopicId,
        userId: owner.id,
      });
      const memberResponse = await app.request(`${TEST_BASE_URL}/api/groups/${groupId}/tools`, {
        headers: { cookie: member.cookie },
      });
      expect(memberResponse.status).toBe(200);
      const tools = (await memberResponse.json()) as Array<{ name: string }>;
      expect(tools).toHaveLength(1);
      const strangerResponse = await app.request(`${TEST_BASE_URL}/api/groups/${groupId}/tools`, {
        headers: { cookie: stranger.cookie },
      });
      expect(strangerResponse.status).toBe(404);
    });

    it('omits tools of a private topic the viewer cannot see', async () => {
      const owner = await ownerWithAi(`g-priv-owner-${emailCounter}@example.com`);
      const admin = await bootstrapUser(
        context,
        authApp,
        `g-priv-admin-${emailCounter}@example.com`,
      );
      const { groupId, generalTopicId } = await seedGroup(
        context,
        owner.id,
        [
          { userId: owner.id, role: 'owner' },
          { userId: admin.id, role: 'admin' },
        ],
        [owner.aiId],
      );
      const privateTopicId = randomUUID();
      const privateRoom = `g${randomBytes(15).toString('hex').slice(0, 15)}`;
      await testSql(context)(
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient;
          yield* sql`INSERT INTO topics (id, group_id, name, glyph, room_localpart, visibility, kind, status, is_general, created_by) VALUES (${privateTopicId}, ${groupId}, ${'Hiring'}, ${'H'}, ${privateRoom}, ${'private'}, ${'chat'}, ${'open'}, ${false}, ${owner.id})`;
          yield* sql`INSERT INTO topic_members (topic_id, user_id, added_by) VALUES (${privateTopicId}, ${owner.id}, ${owner.id})`;
        }),
      );
      await seedTool(context, {
        aiId: owner.aiId,
        groupId,
        topicId: generalTopicId,
        userId: owner.id,
        name: 'general-tool',
      });
      await seedTool(context, {
        aiId: owner.aiId,
        groupId,
        topicId: privateTopicId,
        userId: owner.id,
        name: 'private-tool',
      });
      const adminResponse = await app.request(`${TEST_BASE_URL}/api/groups/${groupId}/tools`, {
        headers: { cookie: admin.cookie },
      });
      expect(adminResponse.status).toBe(200);
      const adminTools = (await adminResponse.json()) as Array<{ name: string }>;
      expect(adminTools.map((tool) => tool.name)).toEqual(['general-tool']);
      const ownerResponse = await app.request(`${TEST_BASE_URL}/api/groups/${groupId}/tools`, {
        headers: { cookie: owner.cookie },
      });
      const ownerTools = (await ownerResponse.json()) as Array<{ name: string }>;
      expect(ownerTools.map((tool) => tool.name).sort()).toEqual(['general-tool', 'private-tool']);
    });
  });

  describe('GET /api/topics/:id/tools', () => {
    it('lists the topic tools for a viewer; 404 for a blind admin or a missing id', async () => {
      const owner = await ownerWithAi(`t-owner-${emailCounter}@example.com`);
      const admin = await bootstrapUser(context, authApp, `t-admin-${emailCounter}@example.com`);
      const { groupId, generalTopicId } = await seedGroup(
        context,
        owner.id,
        [
          { userId: owner.id, role: 'owner' },
          { userId: admin.id, role: 'admin' },
        ],
        [owner.aiId],
      );
      const privateTopicId = randomUUID();
      const privateRoom = `g${randomBytes(15).toString('hex').slice(0, 15)}`;
      await testSql(context)(
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient;
          yield* sql`INSERT INTO topics (id, group_id, name, glyph, room_localpart, visibility, kind, status, is_general, created_by) VALUES (${privateTopicId}, ${groupId}, ${'Hiring'}, ${'H'}, ${privateRoom}, ${'private'}, ${'chat'}, ${'open'}, ${false}, ${owner.id})`;
          yield* sql`INSERT INTO topic_members (topic_id, user_id, added_by) VALUES (${privateTopicId}, ${owner.id}, ${owner.id})`;
        }),
      );
      await seedTool(context, {
        aiId: owner.aiId,
        groupId,
        topicId: privateTopicId,
        userId: owner.id,
        name: 'private-tool',
      });
      const seen = await app.request(`${TEST_BASE_URL}/api/topics/${privateTopicId}/tools`, {
        headers: { cookie: owner.cookie },
      });
      expect(seen.status).toBe(200);
      expect((await seen.json()) as Array<{ name: string }>).toHaveLength(1);
      const blind = await app.request(`${TEST_BASE_URL}/api/topics/${privateTopicId}/tools`, {
        headers: { cookie: admin.cookie },
      });
      expect(blind.status).toBe(404);
      const general = await app.request(`${TEST_BASE_URL}/api/topics/${generalTopicId}/tools`, {
        headers: { cookie: admin.cookie },
      });
      expect(general.status).toBe(200);
      const missing = await app.request(`${TEST_BASE_URL}/api/topics/no-such-topic/tools`, {
        headers: { cookie: admin.cookie },
      });
      expect(missing.status).toBe(404);
      expect(await missing.json()).toEqual(await blind.json());
    });
  });

  describe('read routes', () => {
    it('the owner reads tool, versions, one version and runs', async () => {
      const owner = await ownerWithAi(`read-owner-${emailCounter}@example.com`);
      const toolId = await seedTool(context, {
        aiId: owner.aiId,
        groupId: null,
        topicId: null,
        userId: owner.id,
      });
      for (const path of [
        `/api/tools/${toolId}`,
        `/api/tools/${toolId}/versions`,
        `/api/tools/${toolId}/versions/1`,
        `/api/tools/${toolId}/runs`,
      ]) {
        const response = await app.request(`${TEST_BASE_URL}${path}`, {
          headers: { cookie: owner.cookie },
        });
        expect(response.status, path).toBe(200);
      }
      const tool = (await (
        await app.request(`${TEST_BASE_URL}/api/tools/${toolId}`, {
          headers: { cookie: owner.cookie },
        })
      ).json()) as { source: string };
      expect(tool.source).toContain('gold 3000');
      const versions = (await (
        await app.request(`${TEST_BASE_URL}/api/tools/${toolId}/versions`, {
          headers: { cookie: owner.cookie },
        })
      ).json()) as Array<Record<string, unknown>>;
      expect(versions[0]).not.toHaveProperty('source');
    });

    it('a plain group member can read but gets 404 on revert/delete/run', async () => {
      const owner = await ownerWithAi(`mgmt-owner-${emailCounter}@example.com`);
      const member = await bootstrapUser(
        context,
        authApp,
        `mgmt-member-${emailCounter}@example.com`,
      );
      const { groupId, generalTopicId } = await seedGroup(
        context,
        owner.id,
        [
          { userId: owner.id, role: 'owner' },
          { userId: member.id, role: 'member' },
        ],
        [owner.aiId],
      );
      const toolId = await seedTool(context, {
        aiId: owner.aiId,
        groupId,
        topicId: generalTopicId,
        userId: owner.id,
      });
      const get = await app.request(`${TEST_BASE_URL}/api/tools/${toolId}`, {
        headers: { cookie: member.cookie },
      });
      expect(get.status).toBe(200);
      for (const entry of [
        { method: 'POST', path: `/api/tools/${toolId}/revert`, body: { version: 1 } },
        { method: 'DELETE', path: `/api/tools/${toolId}` },
        { method: 'POST', path: `/api/tools/${toolId}/run`, body: {} },
      ] as const) {
        const response = await app.request(`${TEST_BASE_URL}${entry.path}`, {
          method: entry.method,
          headers: { cookie: member.cookie, 'content-type': 'application/json' },
          body: JSON.stringify(entry.body),
        });
        expect(response.status, `${entry.method} ${entry.path}`).toBe(404);
      }
    });

    it('a group admin who is not the owner can revert/delete/run a group tool but not see personal tools', async () => {
      const owner = await ownerWithAi(`admin-owner-${emailCounter}@example.com`);
      const admin = await bootstrapUser(
        context,
        authApp,
        `admin-admin-${emailCounter}@example.com`,
      );
      const { groupId, generalTopicId } = await seedGroup(
        context,
        owner.id,
        [
          { userId: owner.id, role: 'member' },
          { userId: admin.id, role: 'admin' },
        ],
        [owner.aiId],
      );
      const groupToolId = await seedTool(context, {
        aiId: owner.aiId,
        groupId,
        topicId: generalTopicId,
        userId: owner.id,
      });
      const personalToolId = await seedTool(context, {
        aiId: owner.aiId,
        groupId: null,
        topicId: null,
        userId: owner.id,
      });
      const personal = await app.request(`${TEST_BASE_URL}/api/tools/${personalToolId}`, {
        headers: { cookie: admin.cookie },
      });
      expect(personal.status).toBe(404);
      const revert = await app.request(`${TEST_BASE_URL}/api/tools/${groupToolId}/revert`, {
        method: 'POST',
        headers: { cookie: admin.cookie, 'content-type': 'application/json' },
        body: JSON.stringify({ version: 1 }),
      });
      expect(revert.status).toBe(200);
      const run = await app.request(`${TEST_BASE_URL}/api/tools/${groupToolId}/run`, {
        method: 'POST',
        headers: { cookie: admin.cookie, 'content-type': 'application/json' },
        body: JSON.stringify({}),
      });
      expect(run.status).toBe(200);
      const deleted = await app.request(`${TEST_BASE_URL}/api/tools/${groupToolId}`, {
        method: 'DELETE',
        headers: { cookie: admin.cookie },
      });
      expect(deleted.status).toBe(204);
    });

    it('a stranger gets the missing-id 404 shape everywhere', async () => {
      const owner = await ownerWithAi(`str-owner-${emailCounter}@example.com`);
      const stranger = await bootstrapUser(
        context,
        authApp,
        `str-stranger-${emailCounter}@example.com`,
      );
      const toolId = await seedTool(context, {
        aiId: owner.aiId,
        groupId: null,
        topicId: null,
        userId: owner.id,
      });
      const realNotFound = await app.request(`${TEST_BASE_URL}/api/tools/no-such-tool`, {
        headers: { cookie: owner.cookie },
      });
      expect(realNotFound.status).toBe(404);
      const realBody = await realNotFound.json();
      const strangerGet = await app.request(`${TEST_BASE_URL}/api/tools/${toolId}`, {
        headers: { cookie: stranger.cookie },
      });
      expect(strangerGet.status).toBe(404);
      expect(await strangerGet.json()).toEqual(realBody);
    });
  });

  describe('POST /api/tools/:id/revert', () => {
    it('creates the new version and audits tool.reverted without source', async () => {
      const owner = await ownerWithAi(`revert-owner-${emailCounter}@example.com`);
      const toolId = await seedTool(context, {
        aiId: owner.aiId,
        groupId: null,
        topicId: null,
        userId: owner.id,
      });
      const response = await app.request(`${TEST_BASE_URL}/api/tools/${toolId}/revert`, {
        method: 'POST',
        headers: { cookie: owner.cookie, 'content-type': 'application/json' },
        body: JSON.stringify({ version: 1 }),
      });
      expect(response.status).toBe(200);
      const body = (await response.json()) as { version: number; message: string };
      expect(body.version).toBe(2);
      expect(body.message).toBe('Revert to v1');
      const rows = await testSql(context)(
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient;
          return yield* sql<AuditRow>`SELECT action, detail FROM audit_log`;
        }),
      );
      const reverted = rows.find((row) => row.action === 'tool.reverted');
      expect(reverted?.detail).toEqual({ name: 'morning-prices', version: 2 });
      expect(JSON.stringify(reverted?.detail)).not.toContain('gold 3000');
    });

    it('answers 404 for an unknown version', async () => {
      const owner = await ownerWithAi(`revert-missing-${emailCounter}@example.com`);
      const toolId = await seedTool(context, {
        aiId: owner.aiId,
        groupId: null,
        topicId: null,
        userId: owner.id,
      });
      const response = await app.request(`${TEST_BASE_URL}/api/tools/${toolId}/revert`, {
        method: 'POST',
        headers: { cookie: owner.cookie, 'content-type': 'application/json' },
        body: JSON.stringify({ version: 99 }),
      });
      expect(response.status).toBe(404);
    });
  });

  describe('DELETE /api/tools/:id', () => {
    it('soft-deletes, is idempotent, audits tool.deleted without source', async () => {
      const owner = await ownerWithAi(`del-owner-${emailCounter}@example.com`);
      const toolId = await seedTool(context, {
        aiId: owner.aiId,
        groupId: null,
        topicId: null,
        userId: owner.id,
      });
      const first = await app.request(`${TEST_BASE_URL}/api/tools/${toolId}`, {
        method: 'DELETE',
        headers: { cookie: owner.cookie },
      });
      expect(first.status).toBe(204);
      const second = await app.request(`${TEST_BASE_URL}/api/tools/${toolId}`, {
        method: 'DELETE',
        headers: { cookie: owner.cookie },
      });
      expect(second.status).toBe(204);
      const afterDelete = await app.request(`${TEST_BASE_URL}/api/tools/${toolId}`, {
        headers: { cookie: owner.cookie },
      });
      expect(afterDelete.status).toBe(404);
      const rows = await testSql(context)(
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient;
          return yield* sql<AuditRow>`SELECT action, detail FROM audit_log`;
        }),
      );
      const deleted = rows.filter((row) => row.action === 'tool.deleted');
      expect(deleted).toHaveLength(1);
      expect(deleted[0]?.detail).toEqual({ name: 'morning-prices', version: 1 });
      expect(JSON.stringify(deleted[0]?.detail)).not.toContain('gold 3000');
    });

    it('a group admin re-deleting sees 204, a stranger still sees 404', async () => {
      const owner = await ownerWithAi(`del-admin-${emailCounter}@example.com`);
      const admin = await bootstrapUser(context, authApp, `del-admin2-${emailCounter}@example.com`);
      const stranger = await bootstrapUser(
        context,
        authApp,
        `del-stranger-${emailCounter}@example.com`,
      );
      const { groupId, generalTopicId } = await seedGroup(
        context,
        owner.id,
        [
          { userId: owner.id, role: 'member' },
          { userId: admin.id, role: 'admin' },
        ],
        [owner.aiId],
      );
      const toolId = await seedTool(context, {
        aiId: owner.aiId,
        groupId,
        topicId: generalTopicId,
        userId: owner.id,
      });
      const first = await app.request(`${TEST_BASE_URL}/api/tools/${toolId}`, {
        method: 'DELETE',
        headers: { cookie: admin.cookie },
      });
      expect(first.status).toBe(204);
      const second = await app.request(`${TEST_BASE_URL}/api/tools/${toolId}`, {
        method: 'DELETE',
        headers: { cookie: admin.cookie },
      });
      expect(second.status).toBe(204);
      const strangerDelete = await app.request(`${TEST_BASE_URL}/api/tools/${toolId}`, {
        method: 'DELETE',
        headers: { cookie: stranger.cookie },
      });
      expect(strangerDelete.status).toBe(404);
    });
  });

  describe('POST /api/tools/:id/run', () => {
    it('answers the run result and audits tool.run without output', async () => {
      const owner = await ownerWithAi(`run-owner-${emailCounter}@example.com`);
      const toolId = await seedTool(context, {
        aiId: owner.aiId,
        groupId: null,
        topicId: null,
        userId: owner.id,
      });
      const response = await app.request(`${TEST_BASE_URL}/api/tools/${toolId}/run`, {
        method: 'POST',
        headers: { cookie: owner.cookie, 'content-type': 'application/json' },
        body: JSON.stringify({ input: { day: 'today' } }),
      });
      expect(response.status).toBe(200);
      const body = (await response.json()) as { ok: boolean; output: { text: string } };
      expect(body.ok).toBe(true);
      expect(body.output.text).toBe('ok output');
      const rows = await testSql(context)(
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient;
          return yield* sql<AuditRow>`SELECT action, detail FROM audit_log`;
        }),
      );
      const run = rows.find((row) => row.action === 'tool.run');
      expect(run?.detail).toEqual({ name: 'morning-prices', version: 1, status: 'ok' });
      expect(JSON.stringify(run?.detail)).not.toContain('ok output');
    });

    it('returns 501 without a runner', async () => {
      const noRunnerApp = buildRoutesHarness(context);
      const owner = await ownerWithAi(`norunner-owner-${emailCounter}@example.com`);
      const toolId = await seedTool(context, {
        aiId: owner.aiId,
        groupId: null,
        topicId: null,
        userId: owner.id,
      });
      const response = await noRunnerApp.request(`${TEST_BASE_URL}/api/tools/${toolId}/run`, {
        method: 'POST',
        headers: { cookie: owner.cookie, 'content-type': 'application/json' },
        body: JSON.stringify({}),
      });
      expect(response.status).toBe(501);
      expect(await errorCodeOf(response)).toBe('runner_unavailable');
    });

    it('answers 400 invalid_request when the input serialises past 16 KiB', async () => {
      const owner = await ownerWithAi(`biginput-owner-${emailCounter}@example.com`);
      const toolId = await seedTool(context, {
        aiId: owner.aiId,
        groupId: null,
        topicId: null,
        userId: owner.id,
      });
      const response = await app.request(`${TEST_BASE_URL}/api/tools/${toolId}/run`, {
        method: 'POST',
        headers: { cookie: owner.cookie, 'content-type': 'application/json' },
        body: JSON.stringify({ input: 'x'.repeat(16 * 1024 + 1) }),
      });
      expect(response.status).toBe(400);
      expect(await errorCodeOf(response)).toBe('invalid_request');
    });

    it('returns 409 for a stopped AI', async () => {
      const owner = await ownerWithAi(`stopped-owner-${emailCounter}@example.com`);
      const toolId = await seedTool(context, {
        aiId: owner.aiId,
        groupId: null,
        topicId: null,
        userId: owner.id,
      });
      await testSql(context)(
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient;
          yield* sql`UPDATE ais SET status = 'stopped' WHERE id = ${owner.aiId}`;
        }),
      );
      const response = await app.request(`${TEST_BASE_URL}/api/tools/${toolId}/run`, {
        method: 'POST',
        headers: { cookie: owner.cookie, 'content-type': 'application/json' },
        body: JSON.stringify({}),
      });
      expect(response.status).toBe(409);
      expect(await errorCodeOf(response)).toBe('ai_not_active');
    });

    it('answers 429 after the rate limit', async () => {
      let nowMs = NOW.getTime();
      const limitedApp = buildRoutesHarness(context, {
        toolRunner: fakeRunner(),
        now: () => nowMs,
      });
      const owner = await ownerWithAi(`limited-owner-${emailCounter}@example.com`);
      const toolId = await seedTool(context, {
        aiId: owner.aiId,
        groupId: null,
        topicId: null,
        userId: owner.id,
      });
      for (let index = 0; index < TOOL_RUN_RATE_LIMIT_MAX; index += 1) {
        const response = await limitedApp.request(`${TEST_BASE_URL}/api/tools/${toolId}/run`, {
          method: 'POST',
          headers: { cookie: owner.cookie, 'content-type': 'application/json' },
          body: JSON.stringify({}),
        });
        expect(response.status).toBe(200);
      }
      const limited = await limitedApp.request(`${TEST_BASE_URL}/api/tools/${toolId}/run`, {
        method: 'POST',
        headers: { cookie: owner.cookie, 'content-type': 'application/json' },
        body: JSON.stringify({}),
      });
      expect(limited.status).toBe(429);
      nowMs += 61 * 1000;
      const afterWindow = await limitedApp.request(`${TEST_BASE_URL}/api/tools/${toolId}/run`, {
        method: 'POST',
        headers: { cookie: owner.cookie, 'content-type': 'application/json' },
        body: JSON.stringify({}),
      });
      expect(afterWindow.status).toBe(200);
    });
  });
});
