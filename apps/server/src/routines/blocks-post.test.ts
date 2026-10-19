// An invalid block in a saved tool's output falls back to today's plain post
// instead of reaching the room as a card.
import { describe, expect, it } from 'vitest';
import type { ServerDatabase } from '../db/client';
import { type ExecuteRoutineOptions, type ExecuteRoutinePorts } from './execute';
import { postResult } from './outcomes';
import { type RoutineRow } from '../db/rows-agents';

const NOW = new Date('2026-01-05T12:00:00.000Z');

function routineRow(overrides: Partial<RoutineRow> = {}): RoutineRow {
  return {
    id: 'routine-1',
    aiId: 'ai-1',
    groupId: null,
    topicId: null,
    kind: 'tool',
    toolId: 'tool-1',
    prompt: null,
    title: 'Prices',
    schedule: { kind: 'interval', everyMinutes: 60 },
    input: null,
    approvedHosts: [],
    status: 'active',
    pausedReason: null,
    nextRunAt: NOW,
    lastRunAt: null,
    lastStatus: null,
    lastMessageId: null,
    lastMessageAt: null,
    alertCardId: null,
    alertBlockId: null,
    consecutiveFailures: 0,
    createdBy: 'user-1',
    createdAt: NOW,
    updatedAt: NOW,
    deletedAt: null,
    ...overrides,
  };
}

function recordingPost(): {
  posts: Array<Parameters<ExecuteRoutinePorts['post']>[0]>;
  ports: ExecuteRoutinePorts;
} {
  const posts: Array<Parameters<ExecuteRoutinePorts['post']>[0]> = [];
  return {
    posts,
    ports: {
      runTool: async () => ({
        ok: true,
        output: { text: '' },
        logs: '',
        durationMs: 0,
        fetchCount: 0,
      }),
      post: async (input) => {
        posts.push(input);
        return true;
      },
    },
  };
}

const options: ExecuteRoutineOptions = {
  db: {} as ServerDatabase,
  audit: { record: async () => undefined },
  logger: { warn: () => undefined },
};

describe('postResult blocks', () => {
  it('falls back to a plain post when a link block is invalid', async () => {
    const { posts, ports } = recordingPost();
    const row = routineRow({ title: 'Prices' });

    const posted = await postResult(ports, options, row, 'Example', [
      { kind: 'link', url: 'http://example.com', title: 'Example' },
    ]);

    expect(posted).toBe(true);
    expect(posts).toHaveLength(1);
    expect(posts[0]?.text).toBe('Prices\nExample');
    expect(posts[0]?.payload).toBeUndefined();
  });
});
