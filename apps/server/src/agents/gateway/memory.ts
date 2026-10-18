import { Effect } from 'effect';
import type { ModelTarget } from '../../ai/providers';
import { recordUsage } from '../../ais/usage-store';
import type { AgentGatewayDeps, AiSession, GatewayLogger } from './contracts';
import type { MemoryContext } from '../context';
import { indexMemory, type MemoryScope } from '../memory/indexer';
import { listFacts } from '../memory/facts';
import { renderMemoryBlock } from '../memory/render';
import { completeChat } from '../dm-turn';
import type { ServerDatabase } from '../../db/client';
import { looksLikeSecret } from '../memory/secrets';
import {
  formatBlockId,
  MEMORY_LINE_MAX,
  MEMORY_MIN_BLOCK,
  pending,
  type Block,
} from '../memory/tree';
import { SqlClient } from 'effect/sql';
import { runSql } from '../../effect/sql';
import { blockKey, formatRow, loadNodeMap, loadRows, memoryRange } from '../memory/mirror';
import { blockLines } from '../memory/recall';

// The blocks that can be summarised now, smallest first, only above the floor
// and never past `end` (messages still in the window have no tree yet).
async function pendingNodes(
  db: ServerDatabase,
  aiId: string,
  chatKey: string,
  limit: number,
): Promise<Block[]> {
  const { end, floor } = await memoryRange(db, aiId, chatKey);
  const built = await loadNodeMap(db, aiId, chatKey);
  return pending(end, (block) => built.has(blockKey(block)))
    .filter((block) => block.lo >= floor)
    .slice(0, limit);
}

// What the compactor feeds the model: the raw rows of a size-16 block (deleted
// rows skipped) or the two summaries of a larger block.
async function compactionInput(
  db: ServerDatabase,
  aiId: string,
  chatKey: string,
  block: Block,
): Promise<string[]> {
  const size = block.hi - block.lo;
  if (size === MEMORY_MIN_BLOCK) {
    const rows = await loadRows(db, aiId, chatKey, block);
    return rows.filter((row) => !row.deleted).map(formatRow);
  }

  return blockLines(db, aiId, chatKey, block);
}

// Store one node summary, cut to one line. The cut never leaves a lone high
// surrogate at the end (the string would then be half an astral character). A
// concurrent build wins: a second insert for the same block is dropped.
async function putNode(
  db: ServerDatabase,
  aiId: string,
  chatKey: string,
  block: Block,
  summary: string,
): Promise<void> {
  const cut = summary.slice(0, MEMORY_LINE_MAX);
  const value = /[\uD800-\uDBFF]$/.test(cut) ? cut.slice(0, -1) : cut;
  await runSql(
    db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* sql`INSERT INTO ai_memory_nodes (ai_id, chat_key, lo, hi, summary)
        VALUES (${aiId}, ${chatKey}, ${block.lo}, ${block.hi}, ${value})
        ON CONFLICT DO NOTHING`;
    }),
  );
}

// The pure compaction prompt: the fixed instruction followed by the input
// lines. No text from the chat is formatted here beyond what the caller passes.
function buildCompactionPrompt(blockId: string, inputLines: string[]): string {
  const header =
    `Compress chat memory #${blockId} into one line of at most ${MEMORY_LINE_MAX} characters. ` +
    'Keep what has lasting effect (decisions, facts, preferences, plans, who said what that ' +
    'matters); drop small talk. Invent nothing. Never include passwords, codes, keys or tokens. ' +
    'Reply with the line only.';
  if (inputLines.length === 0) return header;
  return `${header}\n${inputLines.join('\n')}`;
}
interface CompactMemoryInput {
  db: ServerDatabase;
  aiId: string;
  chatKey: string;
  complete: (prompt: string) => Promise<string>;
  limit?: number;
}

interface CompactMemoryResult {
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
const compactMemoryEffect = Effect.fnUntraced(function* (
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
export interface MemoryRunnerContext {
  deps: Pick<AgentGatewayDeps, 'db' | 'archive' | 'fetchImpl'>;
  logger: GatewayLogger;
  secretsFor: (secret?: string) => string[];
  nowMs: () => number;
  toRedactedError: (error: unknown, secrets: readonly string[]) => Error;
  checkDmRoundGate: (session: AiSession) => Promise<{ limited: boolean; reply: string } | null>;
}

export interface MemoryRunner {
  loadMemoryContext: (input: {
    aiId: string;
    chatKey: string;
    archiveOwner: string;
    scope: MemoryScope;
    aiBareJid: string;
    ownerName?: string | undefined;
    now: Date;
    /** Used only to redact log lines; never sent anywhere. */
    secret?: string | undefined;
  }) => Promise<MemoryContext>;
  startCompaction: (session: AiSession, chatKey: string, target: ModelTarget) => void;
}

type LoadMemoryInput = Parameters<MemoryRunner['loadMemoryContext']>[0];

export function createMemoryRunner(ctx: MemoryRunnerContext): MemoryRunner {
  const { deps, logger, secretsFor, nowMs, toRedactedError, checkDmRoundGate } = ctx;

  // Indexes this chat when an archive is configured, then reads its pinned
  // facts and memory block. It never throws and never logs text: a failure
  // still lets the reply go out with what is already stored.
  const loadMemoryContextEffect = Effect.fnUntraced(function* (
    input: LoadMemoryInput,
  ): Effect.fn.Return<MemoryContext> {
    const archive = deps.archive;
    if (archive !== undefined) {
      yield* Effect.promise(() =>
        indexMemory({
          archive,
          db: deps.db,
          aiId: input.aiId,
          chatKey: input.chatKey,
          archiveOwner: input.archiveOwner,
          scope: input.scope,
          aiBareJid: input.aiBareJid,
          ...(input.ownerName === undefined ? {} : { ownerName: input.ownerName }),
          now: input.now,
        }),
      ).pipe(
        Effect.catchDefect((error) =>
          Effect.sync(() => {
            logger.warn(
              { err: toRedactedError(error, secretsFor(input.secret)), aiId: input.aiId },
              'AI memory index failed; replying with stored memory',
            );
          }),
        ),
      );
    }
    return yield* Effect.all(
      [
        Effect.promise(() => listFacts(deps.db, input.aiId, input.chatKey)),
        Effect.promise(() => renderMemoryBlock(deps.db, input.aiId, input.chatKey)),
      ],
      { concurrency: 'unbounded' },
    ).pipe(
      Effect.map(([facts, lines]): MemoryContext => ({
        facts: facts.map((fact) => fact.text),
        lines,
      })),
      Effect.catchDefect((error) =>
        Effect.sync((): MemoryContext => {
          logger.warn(
            { err: toRedactedError(error, secretsFor(input.secret)), aiId: input.aiId },
            'AI memory read failed; replying without stored memory',
          );
          return { facts: [], lines: [] };
        }),
      ),
    );
  });

  // One compaction per (AI, chat) at a time, in memory only. The gateway fires
  // `startCompaction` after a turn's reply and never awaits it, so a slow or
  // failed model call cannot delay or fail the reply. The daily-limit gate is
  // re-checked here (usage can cross the cap mid-turn); prompt and summary text
  // is never logged.
  const runningCompactions = new Set<string>();

  const compactionEffect = Effect.fnUntraced(function* (
    session: AiSession,
    chatKey: string,
    target: ModelTarget,
  ): Effect.fn.Return<void> {
    const gate = yield* Effect.promise(() => checkDmRoundGate(session));
    if (gate !== null) {
      return;
    }
    const startedAt = nowMs();
    const { built, withheld } = yield* compactMemoryEffect({
      db: deps.db,
      aiId: session.aiId,
      chatKey,
      complete: (prompt) =>
        completeChat({
          target,
          messages: [{ role: 'user', content: prompt }],
          ...(deps.fetchImpl === undefined ? {} : { fetchImpl: deps.fetchImpl }),
          secrets: secretsFor(),
          // Compaction is a model call too; count its tokens and cost against
          // the AI, best effort and fire and forget.
          onUsage: (usage) => {
            void recordUsage(
              { db: deps.db, logger },
              session.aiId,
              target.provider,
              target.model,
              usage,
              new Date(nowMs()),
            );
          },
        }),
    });
    if (built > 0) {
      logger.info(
        { aiId: session.aiId, chatKey, built, withheld, ms: nowMs() - startedAt },
        'AI memory compacted',
      );
    }
  });

  function startCompaction(session: AiSession, chatKey: string, target: ModelTarget): void {
    const key = `${session.aiId}:${chatKey}`;
    if (runningCompactions.has(key)) {
      return;
    }
    runningCompactions.add(key);
    Effect.runFork(
      compactionEffect(session, chatKey, target).pipe(
        Effect.catchDefect((error) =>
          Effect.sync(() => {
            logger.warn(
              { err: toRedactedError(error, secretsFor(target.apiKey)), aiId: session.aiId },
              'AI memory compaction failed',
            );
          }),
        ),
        Effect.ensuring(Effect.sync(() => runningCompactions.delete(key))),
      ),
    );
  }

  return {
    loadMemoryContext: (input: LoadMemoryInput): Promise<MemoryContext> =>
      Effect.runPromise(loadMemoryContextEffect(input)),
    startCompaction,
  };
}
