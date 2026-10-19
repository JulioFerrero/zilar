import { describe, expect, it } from 'vitest';
import { addTaskCardStep, startTaskCard, TASK_CARD_MAX_STEPS, type TaskCard } from './task-card';

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
      named: false,
    });
  });
});

describe('addTaskCardStep', () => {
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
