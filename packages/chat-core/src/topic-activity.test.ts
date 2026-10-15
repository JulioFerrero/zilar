import { describe, expect, it } from 'vitest';
import { topicActivityView } from './topic-activity';
import type { TopicAiActivity, TopicAiState } from './types';

function ai(name: string, state: TopicAiState): TopicAiActivity {
  return { aiId: name, name, state };
}

describe('topicActivityView', () => {
  it('keeps working before waiting and labels every active AI', () => {
    const view = topicActivityView([ai('Dev-1', 'working'), ai('QA-1', 'waiting')], null);

    expect(view.active.map((entry) => entry.name)).toEqual(['Dev-1', 'QA-1']);
    expect(view.done).toBe(false);
    expect(view.label).toBe('Dev-1 is working, QA-1 is waiting for you');
  });

  it('reorders a waiting entry that arrived before a working one', () => {
    const view = topicActivityView([ai('QA-1', 'waiting'), ai('Dev-1', 'working')], null);

    expect(view.active.map((entry) => entry.name)).toEqual(['Dev-1', 'QA-1']);
    expect(view.label).toBe('Dev-1 is working, QA-1 is waiting for you');
  });

  it('reads done when nothing is active and an AI finished', () => {
    expect(topicActivityView([ai('Dev-1', 'done')], null)).toEqual({
      active: [],
      done: true,
      label: 'Done',
    });
  });

  it('reads done when a person marked the topic done', () => {
    expect(topicActivityView([], '2026-10-15T10:00:00.000Z')).toEqual({
      active: [],
      done: true,
      label: 'Done',
    });
  });

  it('stays idle with no activity and no done mark', () => {
    expect(topicActivityView([], null)).toEqual({ active: [], done: false, label: '' });
  });

  it('does not read done while an AI is still active', () => {
    const view = topicActivityView([ai('Dev-1', 'working')], '2026-10-15T10:00:00.000Z');

    expect(view.done).toBe(false);
    expect(view.label).toBe('Dev-1 is working');
  });
});
