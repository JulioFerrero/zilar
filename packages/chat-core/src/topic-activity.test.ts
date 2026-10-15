import { describe, expect, it } from 'vitest';
import { liveStageFor, topicActivityView } from './topic-activity';
import type { TopicAiActivity, TopicAiState, UiMessage } from './types';

function ai(name: string, state: TopicAiState): TopicAiActivity {
  return { aiId: name, name, state };
}

const AI_JID = 'dev-1@ai.example.com';

function message(id: string, card: NonNullable<UiMessage['card']>): UiMessage {
  return {
    id,
    chatId: 't-devteam-bug@rooms.zilar.test',
    senderId: AI_JID,
    senderName: 'Dev-1',
    createdAt: new Date(0),
    status: 'sent',
    card,
  };
}

function progressCard(stage: string, state?: 'working' | 'done'): NonNullable<UiMessage['card']> {
  return {
    v: 0,
    type: 'progress',
    data: { ai: AI_JID, stage, ...(state === undefined ? {} : { state }) },
  };
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

describe('liveStageFor', () => {
  it('shows a live card stage and hides it behind a newer finished card', () => {
    const live = message('1', progressCard('Running the tests'));

    expect(liveStageFor([live], AI_JID)).toBe('Running the tests');
    expect(
      liveStageFor([live, message('2', progressCard('Done', 'done'))], AI_JID),
    ).toBeUndefined();
  });
});
