import { describe, expect, it } from 'vitest';
import { BoardUpdateSchema, TaskSchema, TaskStateSchema } from './index';

const task = {
  id: 't-17',
  room: 'project-a@rooms.example.com',
  title: 'Fix the checkout button on mobile',
  owner: 'dev-1@ai.example.com',
  state: 'working',
  depends_on: ['t-16'],
  acceptance: ['Button visible at 375x667'],
  budget: { currency: 'EUR', max: 3 },
  source_message_id: 'm-31',
  artifacts: [{ kind: 'pr', ref: 'https://github.com/acme/shop/pull/42' }],
};

describe('TaskStateSchema', () => {
  it('accepts every documented state', () => {
    const states = [
      'submitted',
      'working',
      'input-required',
      'completed',
      'failed',
      'canceled',
      'rejected',
    ];
    for (const state of states) {
      expect(TaskStateSchema.safeParse(state).success).toBe(true);
    }
  });

  it('rejects an unknown state', () => {
    expect(TaskStateSchema.safeParse('done').success).toBe(false);
  });

  it('rejects an underscored state', () => {
    expect(TaskStateSchema.safeParse('input_required').success).toBe(false);
  });
});

describe('TaskSchema', () => {
  it('accepts a full task', () => {
    const result = TaskSchema.safeParse(task);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual(task);
    }
  });

  it('accepts a task without optional fields', () => {
    const minimal = {
      id: task.id,
      room: task.room,
      title: task.title,
      state: task.state,
      depends_on: task.depends_on,
      acceptance: task.acceptance,
      artifacts: task.artifacts,
    };
    expect(TaskSchema.safeParse(minimal).success).toBe(true);
  });

  it('rejects an unknown state', () => {
    expect(TaskSchema.safeParse({ ...task, state: 'done' }).success).toBe(false);
  });

  it('rejects a title longer than 200 characters', () => {
    expect(TaskSchema.safeParse({ ...task, title: 'a'.repeat(201) }).success).toBe(false);
  });

  it('rejects a missing id', () => {
    const withoutId = {
      room: task.room,
      title: task.title,
      state: task.state,
      depends_on: task.depends_on,
      acceptance: task.acceptance,
      artifacts: task.artifacts,
    };
    expect(TaskSchema.safeParse(withoutId).success).toBe(false);
  });

  it('rejects an extra key', () => {
    expect(TaskSchema.safeParse({ ...task, extra: true }).success).toBe(false);
  });
});

describe('BoardUpdateSchema', () => {
  it('accepts task.created with a room', () => {
    expect(BoardUpdateSchema.safeParse({ op: 'task.created', room: task.room, task }).success).toBe(
      true,
    );
  });

  it('accepts decision.added', () => {
    expect(
      BoardUpdateSchema.safeParse({
        op: 'decision.added',
        room: task.room,
        decision: { id: 'd-1', text: 'Ship on Friday', author: 'ana@example.com' },
      }).success,
    ).toBe(true);
  });

  it('accepts artifact.added', () => {
    expect(
      BoardUpdateSchema.safeParse({
        op: 'artifact.added',
        room: task.room,
        artifact: { id: 'a-1', kind: 'pr', ref: 'https://github.com/acme/shop/pull/42' },
      }).success,
    ).toBe(true);
  });

  it('rejects an unknown op', () => {
    expect(BoardUpdateSchema.safeParse({ op: 'task.deleted', room: task.room, task }).success).toBe(
      false,
    );
  });

  it('rejects a variant without a room', () => {
    expect(BoardUpdateSchema.safeParse({ op: 'task.created', task }).success).toBe(false);
  });

  it('rejects task.created with an invalid task', () => {
    const withoutTitle = {
      id: task.id,
      room: task.room,
      state: task.state,
      depends_on: task.depends_on,
      acceptance: task.acceptance,
      artifacts: task.artifacts,
    };
    expect(
      BoardUpdateSchema.safeParse({ op: 'task.created', room: task.room, task: withoutTitle })
        .success,
    ).toBe(false);
  });

  it('rejects an extra key', () => {
    expect(
      BoardUpdateSchema.safeParse({ op: 'task.created', room: task.room, task, extra: true })
        .success,
    ).toBe(false);
  });
});
