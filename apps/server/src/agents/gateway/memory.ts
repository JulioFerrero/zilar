import { Effect } from 'effect';
import type { ModelTarget } from '../../ai/providers';
import { recordUsage } from '../../ais/usage-store';
import type { AgentGatewayDeps, AiSession, GatewayLogger } from './contracts';
import type { MemoryContext } from '../context';
import { compactMemoryEffect } from '../memory/compactor';
import { indexMemory, type MemoryScope } from '../memory/indexer';
import { listFacts } from '../memory/facts';
import { renderMemoryBlock } from '../memory/render';
import { completeChat } from '../dm-turn';

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
