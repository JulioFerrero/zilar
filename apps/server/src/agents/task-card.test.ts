import { describe, expect, it } from 'vitest';
import {
  addTaskCardStep,
  failTaskCard,
  finishTaskCard,
  startTaskCard,
  taskCardPayload,
  taskCardSummary,
  TASK_CARD_DEFAULT_TITLE,
  TASK_CARD_MAX_STEPS,
  type TaskCard,
} from './task-card';

const STARTED_AT = '2026-10-14T09:00:00.000Z';

function cardWithSteps(labels: string[]): TaskCard {
  let card = startTaskCard('Working', STARTED_AT);
  for (const label of labels) {
    card = addTaskCardStep(card, label);
  }
  return card;
}

describe('startTaskCard', () => {
  it('opens the card with the first stage text as its title', () => {
    const card = startTaskCard('Reading files', STARTED_AT);

    expect(card).toEqual({
      title: 'Reading files',
      stage: 'Reading files',
      steps: [],
      state: 'working',
      startedAt: STARTED_AT,
      summary: null,
    });
  });

  it('falls back to the fixed title when there is no stage text', () => {
    expect(startTaskCard('   ', STARTED_AT).title).toBe(TASK_CARD_DEFAULT_TITLE);
  });
});

describe('addTaskCardStep', () => {
  it('marks the previous step done and the new one doing', () => {
    const card = cardWithSteps(['Reading files', 'Running the tool']);

    expect(card.steps).toEqual([
      { id: 'step-1', label: 'Reading files', state: 'done' },
      { id: 'step-2', label: 'Running the tool', state: 'doing' },
    ]);
    expect(card.stage).toBe('Running the tool');
    expect(card.state).toBe('working');
  });

  it('caps the list at 20 steps and renames the last one', () => {
    const labels = Array.from({ length: TASK_CARD_MAX_STEPS }, (_, index) => `Step ${index + 1}`);
    const capped = cardWithSteps(labels);

    expect(capped.steps).toHaveLength(TASK_CARD_MAX_STEPS);
    expect(capped.steps[TASK_CARD_MAX_STEPS - 1]).toMatchObject({
      id: `step-${TASK_CARD_MAX_STEPS}`,
      label: `Step ${TASK_CARD_MAX_STEPS}`,
      state: 'doing',
    });

    const renamed = addTaskCardStep(capped, 'Step 21');
    expect(renamed.steps).toHaveLength(TASK_CARD_MAX_STEPS);
    expect(renamed.steps[TASK_CARD_MAX_STEPS - 1]).toMatchObject({
      id: `step-${TASK_CARD_MAX_STEPS}`,
      label: 'Step 21',
      state: 'doing',
    });
  });
});

describe('failTaskCard and finishTaskCard', () => {
  it('marks the in-progress step failed', () => {
    const card = failTaskCard(cardWithSteps(['Running the tool']));

    expect(card.state).toBe('failed');
    expect(card.steps[0]).toMatchObject({ label: 'Running the tool', state: 'failed' });
  });

  it('renames the failing step when a label is given', () => {
    const card = failTaskCard(cardWithSteps(['Running the tool']), 'Running the tool (failed)');

    expect(card.steps[0]).toMatchObject({ label: 'Running the tool (failed)', state: 'failed' });
  });

  it('resolves the in-progress step done on a clean finish', () => {
    const card = finishTaskCard(
      cardWithSteps(['Running the tool']),
      'done',
      'Done in 40s · 1 step',
    );

    expect(card.state).toBe('done');
    expect(card.summary).toBe('Done in 40s · 1 step');
    expect(card.steps[0]).toMatchObject({ state: 'done' });
  });

  it('resolves the in-progress step when the turn is stopped', () => {
    const card = finishTaskCard(
      cardWithSteps(['Running the tool']),
      'stopped',
      'Stopped after 40s',
    );

    expect(card.state).toBe('stopped');
    expect(card.summary).toBe('Stopped after 40s');
    // A terminal card must not leave a step spinning.
    expect(card.steps[0]).toMatchObject({ state: 'failed' });
  });
});

describe('taskCardSummary', () => {
  it('uses the fixed done and failed formats', () => {
    expect(taskCardSummary({ state: 'done', elapsedMs: 134_000, stepCount: 3 })).toBe(
      'Done in 2m 14s · 3 steps',
    );
    expect(taskCardSummary({ state: 'done', elapsedMs: 40_000, stepCount: 1 })).toBe(
      'Done in 40s · 1 step',
    );
    expect(taskCardSummary({ state: 'failed', elapsedMs: 40_000, stepCount: 2 })).toBe(
      'Failed after 40s',
    );
  });
});

describe('taskCardPayload', () => {
  it('carries the full card, with elapsed_ms only when given', () => {
    const card = finishTaskCard(
      cardWithSteps(['Running the tool']),
      'done',
      'Done in 40s · 1 step',
    );
    const payload = taskCardPayload({ ai: 'ai-1@zilar.localhost', card, elapsedMs: 40_000 });

    expect(payload).toMatchObject({
      v: 0,
      type: 'progress',
      data: {
        ai: 'ai-1@zilar.localhost',
        stage: 'Running the tool',
        title: 'Working',
        steps: card.steps,
        state: 'done',
        started_at: STARTED_AT,
        elapsed_ms: 40_000,
        summary: 'Done in 40s · 1 step',
      },
    });

    const withoutElapsed = taskCardPayload({ ai: 'ai-1@zilar.localhost', card });
    expect(withoutElapsed.type === 'progress' && 'elapsed_ms' in withoutElapsed.data).toBe(false);
  });
});
