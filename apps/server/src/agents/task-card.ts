import type { Payload, ProgressStep } from '@zilar/protocol';

export type TaskCardState = 'working' | 'done' | 'failed' | 'stopped';

export interface TaskCard {
  title: string;
  stage: string;
  steps: ProgressStep[];
  state: TaskCardState;
  startedAt: string;
  summary: string | null;
  named: boolean;
}

export const TASK_CARD_DEFAULT_TITLE = 'Working on it';

export const TASK_CARD_MAX_STEPS = 20;

function titleFor(stage: string): string {
  return stage.trim() === '' ? TASK_CARD_DEFAULT_TITLE : stage;
}

function stepId(index: number): string {
  return `step-${index}`;
}

export function startTaskCard(stage: string, startedAt: string): TaskCard {
  return {
    title: titleFor(stage),
    stage,
    steps: [],
    state: 'working',
    startedAt,
    summary: null,
    named: false,
  };
}

export function nameTaskCard(card: TaskCard, title: string): TaskCard {
  const clean = title.trim();
  if (clean === '' || card.named) {
    return card;
  }
  const steps: ProgressStep[] =
    card.steps.length === 0 && card.stage.trim() !== ''
      ? [{ id: stepId(1), label: card.stage, state: 'doing' }]
      : card.steps.map((step) => ({ ...step }));
  return { ...card, title: clean, steps, named: true };
}

/** Appends a step: the previous in-progress step becomes `done` and the new
 * one `doing`. At the cap the newest label renames the last step instead of
 * adding a 21st. */
export function addTaskCardStep(card: TaskCard, label: string): TaskCard {
  if (card.steps.length === 0 && label === card.title) {
    return { ...card, stage: label };
  }
  const steps: ProgressStep[] = card.steps.map((step) => ({ ...step }));
  const last = steps[steps.length - 1];
  if (last !== undefined) {
    if (steps.length >= TASK_CARD_MAX_STEPS) {
      last.label = label;
      return { ...card, stage: label, steps };
    }
    last.state = 'done';
  }
  steps.push({ id: stepId(steps.length + 1), label, state: 'doing' });
  return { ...card, stage: label, steps };
}

/** Closes the card: sets `state` and `summary`, and resolves the in-progress
 * step (`done` on a clean finish, `failed` otherwise). */
export function finishTaskCard(
  card: TaskCard,
  state: 'done' | 'failed' | 'stopped',
  summary: string,
): TaskCard {
  const steps: ProgressStep[] = card.steps.map((step) => ({ ...step }));
  const last = steps[steps.length - 1];
  if (last !== undefined && last.state === 'doing') {
    // A stopped turn is terminal too: the interrupted step must not keep
    // spinning on a closed card. Only a clean finish is `done`.
    last.state = state === 'done' ? 'done' : 'failed';
  }
  return { ...card, steps, state, summary };
}

/** Whole seconds: "2m 14s", "40s", "1h 2m". */
export function formatTaskCardElapsed(elapsedMs: number): string {
  const totalSeconds = Math.max(0, Math.round(elapsedMs / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }
  if (minutes > 0) {
    return `${minutes}m ${seconds}s`;
  }
  return `${seconds}s`;
}

/** The fixed summary format: "Done in 2m 14s · 3 steps" or "Failed after 40s".
 * Fixed text only, and no money. */
export function taskCardSummary(input: {
  state: 'done' | 'failed' | 'stopped';
  elapsedMs: number;
  stepCount: number;
}): string {
  const elapsed = formatTaskCardElapsed(input.elapsedMs);
  if (input.state === 'done') {
    return `Done in ${elapsed} · ${input.stepCount} ${input.stepCount === 1 ? 'step' : 'steps'}`;
  }
  if (input.state === 'stopped') {
    return `Stopped after ${elapsed}`;
  }
  return `Failed after ${elapsed}`;
}

/** The full `progress` payload for the card. `elapsed_ms` rides the final
 * correction only. */
export function taskCardPayload(input: {
  ai: string;
  taskId?: string;
  card: TaskCard;
  elapsedMs?: number;
}): Payload {
  return {
    v: 0,
    type: 'progress',
    data: {
      ai: input.ai,
      ...(input.taskId === undefined ? {} : { task_id: input.taskId }),
      stage: input.card.stage,
      title: input.card.title,
      steps: input.card.steps,
      state: input.card.state,
      ...(input.card.state === 'working' ? { can_stop: true } : {}),
      started_at: input.card.startedAt,
      ...(input.card.summary === null ? {} : { summary: input.card.summary }),
      ...(input.elapsedMs === undefined ? {} : { elapsed_ms: input.elapsedMs }),
    },
  };
}
