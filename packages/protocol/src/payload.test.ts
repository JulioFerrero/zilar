import { describe, expect, it } from 'vitest';
import { decodePayload, encodePayload, MAX_PAYLOAD_BYTES, type Payload, type Task } from './index';

const taskData: Task = {
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

const payloadExamples: Payload[] = [
  {
    v: 0,
    type: 'task',
    data: taskData,
  },
  {
    v: 0,
    type: 'handoff',
    data: {
      task_id: 't-17',
      from: 'boss@ai.example.com',
      to: 'dev-1@ai.example.com',
      objective: 'Fix the checkout button overlapping the footer on mobile',
      context_summary: 'Reported by Ana (PM) in #project-a, affects iOS Safari only.',
      acceptance: ['Button fully visible at 375x667'],
      constraints: ['Only touch src/checkout/*'],
      artifacts: [
        { kind: 'message', ref: 'm-31' },
        { kind: 'pr', ref: 'https://github.com/acme/shop/pull/42' },
      ],
      budget: { currency: 'EUR', max: 3 },
      return_format: 'PR link + 3-line summary',
      reply_to: 'thread:m-31',
    },
  },
  {
    v: 0,
    type: 'approval.request',
    data: {
      id: 'a-1',
      room: 'project-a@rooms.example.com',
      ai: 'marketing@ai.example.com',
      action: 'ads.campaign.start',
      summary: 'Start the Autumn launch campaign',
      details: 'diff --git a/ads.ts b/ads.ts',
      args_hash: 'a'.repeat(64),
      worst_case_cost: { currency: 'EUR', amount: 912 },
      requested_by: 'ana@example.com',
      expires_at: '2026-09-27T12:00:00Z',
    },
  },
  {
    v: 0,
    type: 'approval.decision',
    data: {
      approval_id: 'a-1',
      decision: 'approve_once',
      note: 'Approved for this campaign only',
      decided_by: 'ana@example.com',
      decided_at: '2026-09-27T11:00:00Z',
    },
  },
  {
    v: 0,
    type: 'progress',
    data: {
      ai: 'dev-1@ai.example.com',
      task_id: 't-17',
      stage: 'running the test suite',
      detail: 'pnpm test',
      percent: 40,
    },
  },
  {
    v: 0,
    type: 'board.update',
    data: { op: 'task.created', room: taskData.room, task: taskData },
  },
  {
    v: 0,
    type: 'preview',
    data: {
      ai: 'qa@ai.example.com',
      url: 'https://p-7f3a.preview.example.com',
      label: 'Checkout fix on iOS',
      expires_at: '2026-09-28T00:00:00Z',
    },
  },
  {
    v: 0,
    type: 'cost',
    data: {
      ai: 'dev-1@ai.example.com',
      room: 'project-a@rooms.example.com',
      amount: { currency: 'USD', amount: 0.12 },
      tokens: { input: 1000, output: 200 },
    },
  },
  {
    v: 0,
    type: 'wake',
    data: {
      ai: 'qa@ai.example.com',
      score: 0.8,
      reason: 'Dev asked QA to test the preview',
      message_ids: ['m-31', 'm-42'],
    },
  },
  {
    v: 0,
    type: 'poll',
    data: {
      id: 'p-1',
      question: 'Where should the offsite be?',
      options: [
        { id: 'o-1', label: 'Beach' },
        { id: 'o-2', label: 'Mountains' },
      ],
      multiple: false,
      closes_at: '2026-09-30T18:00:00Z',
    },
  },
  {
    v: 0,
    type: 'poll.vote',
    data: { poll_id: 'p-1', option_ids: ['o-1'], voter: 'ana@example.com' },
  },
  {
    v: 0,
    type: 'voice',
    data: {
      duration_ms: 12400,
      mime: 'audio/mp4',
      waveform: [0, 64, 128, 255],
      transcript: { text: 'Quick update on the release.', language: 'en', source: 'api' },
    },
  },
];

const expectedTypes = [
  'task',
  'handoff',
  'approval.request',
  'approval.decision',
  'progress',
  'board.update',
  'preview',
  'cost',
  'wake',
  'poll',
  'poll.vote',
  'voice',
];

describe('PayloadSchema', () => {
  it('round-trips an example of every payload type', () => {
    expect(payloadExamples.map((payload) => payload.type)).toEqual(expectedTypes);

    for (const payload of payloadExamples) {
      expect(decodePayload(encodePayload(payload))).toEqual({ ok: true, payload });
    }
  });
});

describe('decodePayload', () => {
  it('rejects a payload above the byte limit', () => {
    const tooLarge = 'a'.repeat(70 * 1024);
    expect(tooLarge.length).toBeGreaterThan(MAX_PAYLOAD_BYTES);
    expect(decodePayload(tooLarge).ok).toBe(false);
  });

  it('counts UTF-8 bytes, not UTF-16 characters, for the size limit', () => {
    const emoji = '😀'.repeat(20 * 1024);
    expect(emoji.length).toBeLessThan(MAX_PAYLOAD_BYTES);
    expect(decodePayload(`{"v":0,"type":"task","data":{"title":"${emoji}"}}`).ok).toBe(false);
  });

  it('rejects invalid JSON', () => {
    expect(decodePayload('not json at all').ok).toBe(false);
  });

  it('rejects null', () => {
    expect(decodePayload('null').ok).toBe(false);
  });

  it('rejects an array', () => {
    expect(decodePayload('[]').ok).toBe(false);
  });

  it('rejects an unsupported version', () => {
    expect(decodePayload(JSON.stringify({ v: 1, type: 'task', data: {} }))).toEqual({
      ok: false,
      error: 'unsupported payload version',
    });
  });

  it('rejects an unknown type', () => {
    expect(decodePayload(JSON.stringify({ v: 0, type: 'nope', data: {} }))).toEqual({
      ok: false,
      error: 'unknown payload type',
    });
  });

  it('rejects a known envelope whose data fails validation', () => {
    expect(decodePayload(JSON.stringify({ v: 0, type: 'task', data: {} })).ok).toBe(false);
  });

  it('never throws on hostile input', () => {
    const hostileInputs = [
      '',
      ' ',
      'null',
      'undefined',
      '[]',
      '{}',
      '{"v":1,"type":"task","data":{}}',
      '{"v":0,"type":"nope","data":{}}',
      '{"v":0,"type":"task"}',
      '{"v":0,"type":"task","data":{}}',
      '{"v":0}',
      '{"type":"task"}',
      'not json',
      '{"v":0,"type":"task","data":{"title":null}}',
    ];

    for (const input of hostileInputs) {
      try {
        const result = decodePayload(input);
        expect(result.ok).toBe(false);
      } catch (error) {
        throw new Error(
          `decodePayload threw for ${JSON.stringify(input.slice(0, 40))}: ${String(error)}`,
        );
      }
    }
  });

  it('never echoes more than 100 characters of the raw input', () => {
    const marker = 'SECRET-MARKER-'.repeat(50);
    const result = decodePayload(JSON.stringify({ v: 0, type: marker, data: {} }));

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.length).toBeLessThanOrEqual(100);
      expect(result.error).not.toContain(marker);
    }
  });
});
