// T-0446: the memory compactor (docs/audit/ai-memory-plan.md §3.7). After a
// turn's reply, the gateway calls `compactMemory` in the background: it builds
// up to `limit` pending summary nodes for one (AI, chat), smallest first, using
// the AI's own model (the caller supplies `complete`). It never logs, and text
// only ever moves from the mirror into a summary.

import { Effect } from 'effect';
import type { ServerDatabase } from '../../db/client';
import { looksLikeSecret } from './secrets';
import { buildCompactionPrompt, compactionInput, pendingNodes, putNode } from './store';
import { formatBlockId } from './tree';

export interface CompactMemoryInput {
  db: ServerDatabase;
  aiId: string;
  chatKey: string;
  complete: (prompt: string) => Promise<string>;
  limit?: number;
}

export interface CompactMemoryResult {
  built: number;
  withheld: number;
}

const DEFAULT_LIMIT = 4;
const NOTHING_KEPT = '(nothing kept)';
const SUMMARY_WITHHELD = '(summary withheld)';

// The first non-empty line of the model's reply, trimmed; '' when there is none.
function firstLine(raw: string): string {
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (trimmed !== '') return trimmed;
  }
  return '';
}

// Build the pending nodes for one chat, in order. A `complete` that throws
// stops the loop and is rethrown: the caller (the gateway) logs it. A block
// whose input is empty (every row deleted) is stored as `(nothing kept)`
// without a model call; a summary that looks like a secret is withheld. The
// database and model calls are lifted with plain `Effect.promise`, so a
// failure dies with the original error and `runPromise` rejects with it
// unwrapped.
export const compactMemoryEffect = Effect.fnUntraced(function* (
  input: CompactMemoryInput,
): Effect.fn.Return<CompactMemoryResult> {
  const { db, aiId, chatKey, complete } = input;
  const limit = input.limit ?? DEFAULT_LIMIT;
  let built = 0;
  let withheld = 0;

  const blocks = yield* Effect.promise(() => pendingNodes(db, aiId, chatKey, limit));
  for (const block of blocks) {
    const lines = yield* Effect.promise(() => compactionInput(db, aiId, chatKey, block));
    let summary = NOTHING_KEPT;
    if (lines.length > 0) {
      const raw = yield* Effect.promise(() =>
        complete(buildCompactionPrompt(formatBlockId(block), lines)),
      );
      const line = firstLine(raw);
      if (line !== '') summary = line;
    }
    if (looksLikeSecret(summary)) {
      summary = SUMMARY_WITHHELD;
      withheld += 1;
    }
    yield* Effect.promise(() => putNode(db, aiId, chatKey, block, summary));
    built += 1;
  }

  return { built, withheld };
});

export function compactMemory(input: CompactMemoryInput): Promise<CompactMemoryResult> {
  return Effect.runPromise(compactMemoryEffect(input));
}
