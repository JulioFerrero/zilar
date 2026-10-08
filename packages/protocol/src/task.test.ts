import { describe, expect, it } from 'vitest';
import { BoardUpdateSchema, decodeOrThrow, isValid, TaskSchema, TaskStateSchema } from './index';

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
      expect(isValid(TaskStateSchema)(state)).toBe(true);
    }
  });

  it('rejects an unknown state', () => {
    expect(isValid(TaskStateSchema)('done')).toBe(false);
  });

  it('rejects an underscored state', () => {
    expect(isValid(TaskStateSchema)('input_required')).toBe(false);
  });
});

describe('TaskSchema', () => {
  it('accepts a full task', () => {
    expect(isValid(TaskSchema)(task)).toBe(true);
    expect(decodeOrThrow(TaskSchema)(task)).toEqual(task);
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
    expect(isValid(TaskSchema)(minimal)).toBe(true);
  });

  it('rejects an unknown state', () => {
    expect(isValid(TaskSchema)({ ...task, state: 'done' })).toBe(false);
  });

  it('rejects a title longer than 200 characters', () => {
    expect(isValid(TaskSchema)({ ...task, title: 'a'.repeat(201) })).toBe(false);
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
    expect(isValid(TaskSchema)(withoutId)).toBe(false);
  });

  it('rejects an extra key', () => {
    expect(isValid(TaskSchema)({ ...task, extra: true })).toBe(false);
  });
});

describe('BoardUpdateSchema', () => {
  it('accepts task.created with a room', () => {
    expect(isValid(BoardUpdateSchema)({ op: 'task.created', room: task.room, task })).toBe(true);
  });

  it('accepts decision.added', () => {
    expect(
      isValid(BoardUpdateSchema)({
        op: 'decision.added',
        room: task.room,
        decision: { id: 'd-1', text: 'Ship on Friday', author: 'ana@example.com' },
      }),
    ).toBe(true);
  });

  it('accepts artifact.added', () => {
    expect(
      isValid(BoardUpdateSchema)({
        op: 'artifact.added',
        room: task.room,
        artifact: { id: 'a-1', kind: 'pr', ref: 'https://github.com/acme/shop/pull/42' },
      }),
    ).toBe(true);
  });

  it('rejects an unknown op', () => {
    expect(isValid(BoardUpdateSchema)({ op: 'task.deleted', room: task.room, task })).toBe(false);
  });

  it('rejects a variant without a room', () => {
    expect(isValid(BoardUpdateSchema)({ op: 'task.created', task })).toBe(false);
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
      isValid(BoardUpdateSchema)({ op: 'task.created', room: task.room, task: withoutTitle }),
    ).toBe(false);
  });

  it('rejects an extra key', () => {
    expect(
      isValid(BoardUpdateSchema)({ op: 'task.created', room: task.room, task, extra: true }),
    ).toBe(false);
  });
});
