import type {
  AlertBlock,
  Block,
  BlocksData,
  ButtonsBlock,
  ChecklistBlock,
  ChoiceBlock,
  FormBlock,
  PollBlock,
  RatingBlock,
} from '@zilar/protocol';
import { MAX_SHORT } from '@zilar/protocol';
import { type BlockResponseRow } from '../db/rows-agents';

// The pure state merge every reader uses. Returns a new `BlocksData`; the input
// is never mutated and the result still decodes as `BlocksDataSchema`.

type NameOf = (actorId: string) => string | undefined;

export function fieldOf(value: unknown, key: string): unknown {
  if (typeof value !== 'object' || value === null) {
    return undefined;
  }
  return (value as Record<string, unknown>)[key];
}

function booleanField(value: unknown, key: string): boolean | undefined {
  const field = fieldOf(value, key);
  return typeof field === 'boolean' ? field : undefined;
}

function indexField(value: unknown, key: string): number | undefined {
  const field = fieldOf(value, key);
  return typeof field === 'number' && Number.isInteger(field) && field >= 0 ? field : undefined;
}

function stringField(value: unknown, key: string): string | undefined {
  const field = fieldOf(value, key);
  return typeof field === 'string' ? field : undefined;
}

// The latest row of one block, ties going to the later row.
function latestRow(
  rows: readonly BlockResponseRow[],
  blockId: string,
): BlockResponseRow | undefined {
  let latest: BlockResponseRow | undefined;
  for (const row of rows) {
    if (row.blockId !== blockId) {
      continue;
    }
    if (latest === undefined || row.updatedAt.getTime() >= latest.updatedAt.getTime()) {
      latest = row;
    }
  }
  return latest;
}

function latestByItem(
  rows: readonly BlockResponseRow[],
  blockId: string,
): Map<string, BlockResponseRow> {
  const latest = new Map<string, BlockResponseRow>();
  for (const row of rows) {
    if (row.blockId !== blockId) {
      continue;
    }
    const current = latest.get(row.itemId);
    if (current === undefined || row.updatedAt.getTime() >= current.updatedAt.getTime()) {
      latest.set(row.itemId, row);
    }
  }
  return latest;
}

function applyChecklist(
  block: ChecklistBlock,
  rows: readonly BlockResponseRow[],
  nameOf: NameOf,
): ChecklistBlock {
  const latest = latestByItem(rows, block.id);
  const items = block.items.map((item) => {
    const row = latest.get(item.id);
    const done = row === undefined ? undefined : booleanField(row.value, 'done');
    if (row === undefined || done === undefined) {
      return { ...item };
    }
    if (!done) {
      const next = { ...item, done: false };
      delete next.by;
      return next;
    }
    const name = nameOf(row.actorId);
    return name === undefined ? { ...item, done: true } : { ...item, done: true, by: name };
  });
  return { ...block, items };
}

function applyPoll(block: PollBlock, rows: readonly BlockResponseRow[]): PollBlock {
  const votes = rows.filter((row) => row.blockId === block.id);
  const options = block.options.map((option) => ({
    ...option,
    votes: votes.filter((row) => row.itemId === option.id).length,
  }));
  return { ...block, options, votes: new Set(votes.map((row) => row.actorId)).size };
}

function applyChoice(block: ChoiceBlock, rows: readonly BlockResponseRow[]): ChoiceBlock {
  const row = latestRow(rows, block.id);
  const selected = row === undefined ? undefined : indexField(row.value, 'selected');
  return selected === undefined ? block : { ...block, selected };
}

function applyRating(block: RatingBlock, rows: readonly BlockResponseRow[]): RatingBlock {
  const row = latestRow(rows, block.id);
  const selected = row === undefined ? undefined : indexField(row.value, 'rating');
  return selected === undefined ? block : { ...block, selected };
}

function applyButtons(
  block: ButtonsBlock,
  rows: readonly BlockResponseRow[],
  nameOf: NameOf,
): ButtonsBlock {
  const row = latestRow(rows, block.id);
  const actionId = row === undefined ? undefined : stringField(row.value, 'actionId');
  if (row === undefined || actionId === undefined) {
    return block;
  }
  if (!block.actions.some((action) => action.id === actionId)) {
    return block;
  }
  const name = nameOf(row.actorId);
  const at = row.updatedAt.toISOString();
  return {
    ...block,
    chosen: name === undefined ? { actionId, at } : { actionId, at, by: name },
  };
}

function applyForm(block: FormBlock, rows: readonly BlockResponseRow[], nameOf: NameOf): FormBlock {
  const row = latestRow(rows, block.id);
  const answer = row === undefined ? undefined : fieldOf(row.value, 'fields');
  if (row === undefined || typeof answer !== 'object' || answer === null) {
    return block;
  }
  const fields = block.fields.map((field) => {
    const text = (answer as Record<string, unknown>)[field.id];
    if (typeof text !== 'string') {
      return { ...field };
    }
    const value = text.trim();
    const fits = value.length > MAX_SHORT ? `${value.slice(0, MAX_SHORT - 1)}…` : value;
    return { ...field, value: fits };
  });
  const name = nameOf(row.actorId);
  const at = row.updatedAt.toISOString();
  return {
    ...block,
    fields,
    sent: name === undefined ? { at } : { at, by: name },
  };
}

// The latest answer sets the switch and/or threshold; a missing field keeps the
// card's value.
function applyAlert(block: AlertBlock, rows: readonly BlockResponseRow[]): AlertBlock {
  const row = latestRow(rows, block.id);
  if (row === undefined) {
    return block;
  }
  const on = booleanField(row.value, 'on');
  const threshold = stringField(row.value, 'threshold');
  if (on === undefined && threshold === undefined) {
    return block;
  }
  const next: AlertBlock = { ...block };
  if (on !== undefined) {
    next.on = on;
  }
  if (threshold !== undefined) {
    const value = threshold.trim();
    const fits = value.length > MAX_SHORT ? `${value.slice(0, MAX_SHORT - 1)}…` : value;
    next.field = { ...block.field, value: fits };
  }
  return next;
}

function applyBlock(block: Block, rows: readonly BlockResponseRow[], nameOf: NameOf): Block {
  switch (block.kind) {
    case 'checklist':
      return applyChecklist(block, rows, nameOf);
    case 'poll':
      return applyPoll(block, rows);
    case 'choice':
      return applyChoice(block, rows);
    case 'rating':
      return applyRating(block, rows);
    case 'buttons':
      return applyButtons(block, rows, nameOf);
    case 'form':
      return applyForm(block, rows, nameOf);
    case 'alert':
      return applyAlert(block, rows);
    default:
      return block;
  }
}

export function applyResponses(
  data: BlocksData,
  rows: readonly BlockResponseRow[],
  nameOf: NameOf,
): BlocksData {
  return { ...data, blocks: data.blocks.map((block) => applyBlock(block, rows, nameOf)) };
}
