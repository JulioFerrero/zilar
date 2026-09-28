import { describe, expect, it } from 'vitest';
import { parsePermission, summarizeSession } from './session';

function idle(outcome = 'done', created = 2000) {
  return { id: 'm2', type: 'idle', outcome, time: { created } };
}

function text(created = 2000) {
  return { id: 'm1', type: 'text', content: [{ type: 'text', text: 'hi' }], time: { created } };
}

describe('summarizeSession', () => {
  it('is idle when the newest message is idle', () => {
    const summary = summarizeSession([idle(), text(1000)]);
    expect(summary.state).toBe('idle');
    expect(summary.outcome).toBe('done');
  });

  it('treats an interrupt as still running (the lead interrupted it)', () => {
    const summary = summarizeSession([idle('interrupted')]);
    expect(summary.state).toBe('running');
  });

  it('is running when the newest message is not idle', () => {
    expect(summarizeSession([text()]).state).toBe('running');
  });

  it('is unknown with no messages', () => {
    expect(summarizeSession([]).state).toBe('unknown');
  });

  it('detects a provider.quota error type', () => {
    const messages = [text(), { id: 'e', type: 'error', error: { type: 'provider.quota' } }];
    expect(summarizeSession(messages).quotaError).toBe(true);
  });

  it('detects a 402 status on an error object', () => {
    const messages = [
      idle(),
      { id: 'e', type: 'text', error: { status: 402, message: 'quota spent' } },
    ];
    expect(summarizeSession(messages).quotaError).toBe(true);
  });

  it('does not flag other errors as quota errors', () => {
    const messages = [idle(), { id: 'e', type: 'error', error: { status: 500 } }];
    expect(summarizeSession(messages).quotaError).toBe(false);
  });

  it('detects a running question tool call with its text', () => {
    const messages = [
      {
        id: 'm',
        type: 'text',
        time: { created: 3000 },
        content: [
          {
            type: 'tool',
            id: 'call_q1',
            name: 'question',
            state: {
              status: 'running',
              input: { questions: [{ question: 'Which simulator?' }] },
            },
          },
        ],
      },
    ];
    const summary = summarizeSession(messages);
    expect(summary.questionRunning).toBe(true);
    expect(summary.questionIds).toEqual(['call_q1']);
    expect(summary.questionText).toContain('Which simulator?');
  });

  it('ignores answered questions', () => {
    const messages = [
      {
        id: 'm',
        type: 'text',
        content: [
          {
            type: 'tool',
            id: 'call_q1',
            name: 'question',
            state: { status: 'completed', input: { questions: [] } },
          },
        ],
      },
    ];
    expect(summarizeSession(messages).questionRunning).toBe(false);
  });
});

describe('parsePermission', () => {
  it('parses a full request', () => {
    expect(parsePermission({ id: 'per_1', action: 'shell', resources: 'git push' })).toEqual({
      id: 'per_1',
      action: 'shell',
      command: 'git push',
    });
  });

  it('returns null for unshaped entries', () => {
    expect(parsePermission(null)).toBeNull();
    expect(parsePermission({ id: 'per_1' })).toBeNull();
    expect(parsePermission('nope')).toBeNull();
  });
});
