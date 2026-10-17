import type {
  Block,
  BlocksData,
  ChecklistBlock,
  ChoiceBlock,
  PollBlock,
  RatingBlock,
} from '@zilar/protocol';
import type { BlockResponseRow } from '../db/rows';

// The pure state merge (B8a): every reader (the route, the correction) turns a
// card's stored responses into the drawn card state the same way. Returns a new
// `BlocksData`; the input is never mutated and the result still decodes as
// `BlocksDataSchema`.

type NameOf = (actorId: string) => string | undefined;

function fieldOf(value: unknown, key: string): unknown {
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

// The latest row per `item_id` of one block.
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
