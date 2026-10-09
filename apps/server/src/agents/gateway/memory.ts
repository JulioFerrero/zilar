import { Effect } from 'effect';
import type { AgentGatewayDeps, AiSession, GatewayLogger } from './contracts';
import type { MemoryContext } from '../context';
import { compactMemoryEffect } from '../memory/compactor';
import { indexMemory, type MemoryScope } from '../memory/indexer';
import { listFacts, renderMemoryBlock } from '../memory/store';
import { completeChat } from '../reply';

export interface MemoryRunnerContext {
  deps: Pick<AgentGatewayDeps, 'db' | 'archive' | 'fetchImpl'>;
  logger: GatewayLogger;
  baseUrl: string;
  modelNameForAi: (aiId: string) => string;
  secretsFor: (virtualKey?: string) => string[];
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
    virtualKey?: string | undefined;
  }) => Promise<MemoryContext>;
  startCompaction: (session: AiSession, chatKey: string, virtualKey: string) => void;
}

type LoadMemoryInput = Parameters<MemoryRunner['loadMemoryContext']>[0];

export function createMemoryRunner(ctx: MemoryRunnerContext): MemoryRunner {
  const {
    deps,
    logger,
    baseUrl,
    modelNameForAi,
    secretsFor,
    nowMs,
    toRedactedError,
    checkDmRoundGate,
  } = ctx;

  // Indexes this chat when an archive is configured, then reads its pinned
  // facts and memory block. It never throws and never logs text: a failure
  // still lets the reply go out with whatever is already stored. The calls are
  // lifted with plain `Effect.promise`, so a rejection dies with the original
  // error and `catchDefect` logs it, like the old `catch` blocks.
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
              { err: toRedactedError(error, secretsFor(input.virtualKey)), aiId: input.aiId },
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
            { err: toRedactedError(error, secretsFor(input.virtualKey)), aiId: input.aiId },
            'AI memory read failed; replying without stored memory',
          );
          return { facts: [], lines: [] };
        }),
      ),
    );
  });

  // T-0446: one compaction per (AI, chat) at a time, in memory only. The
  // gateway fires `startCompaction` after a turn's reply; it is never awaited,
  // so a slow or failed model call can neither delay nor fail the reply. The
  // daily-limit gate is re-checked here (usage can have crossed the cap since
  // the turn started) and the run never logs prompt or summary text.
  const runningCompactions = new Set<string>();

  const compactionEffect = Effect.fnUntraced(function* (
    session: AiSession,
    chatKey: string,
    virtualKey: string,
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
          baseUrl,
          virtualKey,
          model: modelNameForAi(session.aiId),
          messages: [{ role: 'user', content: prompt }],
          ...(deps.fetchImpl === undefined ? {} : { fetchImpl: deps.fetchImpl }),
          secrets: secretsFor(),
        }),
    });
    if (built > 0) {
      logger.info(
        { aiId: session.aiId, chatKey, built, withheld, ms: nowMs() - startedAt },
        'AI memory compacted',
      );
    }
  });

  function startCompaction(session: AiSession, chatKey: string, virtualKey: string): void {
    const key = `${session.aiId}:${chatKey}`;
    if (runningCompactions.has(key)) {
      return;
    }
    runningCompactions.add(key);
    Effect.runFork(
      compactionEffect(session, chatKey, virtualKey).pipe(
        Effect.catchDefect((error) =>
          Effect.sync(() => {
            logger.warn(
              { err: toRedactedError(error, secretsFor(virtualKey)), aiId: session.aiId },
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
