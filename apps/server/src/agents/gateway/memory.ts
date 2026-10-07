import type { AgentGatewayDeps, AiSession, GatewayLogger } from './contracts';
import type { MemoryContext } from '../context';
import { compactMemory } from '../memory/compactor';
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
  // still lets the reply go out with whatever is already stored.
  async function loadMemoryContext(input: {
    aiId: string;
    chatKey: string;
    archiveOwner: string;
    scope: MemoryScope;
    aiBareJid: string;
    ownerName?: string | undefined;
    now: Date;
    virtualKey?: string | undefined;
  }): Promise<MemoryContext> {
    if (deps.archive !== undefined) {
      try {
        await indexMemory({
          archive: deps.archive,
          db: deps.db,
          aiId: input.aiId,
          chatKey: input.chatKey,
          archiveOwner: input.archiveOwner,
          scope: input.scope,
          aiBareJid: input.aiBareJid,
          ...(input.ownerName === undefined ? {} : { ownerName: input.ownerName }),
          now: input.now,
        });
      } catch (error) {
        logger.warn(
          { err: toRedactedError(error, secretsFor(input.virtualKey)), aiId: input.aiId },
          'AI memory index failed; replying with stored memory',
        );
      }
    }
    try {
      const [facts, lines] = await Promise.all([
        listFacts(deps.db, input.aiId, input.chatKey),
        renderMemoryBlock(deps.db, input.aiId, input.chatKey),
      ]);
      return { facts: facts.map((fact) => fact.text), lines };
    } catch (error) {
      logger.warn(
        { err: toRedactedError(error, secretsFor(input.virtualKey)), aiId: input.aiId },
        'AI memory read failed; replying without stored memory',
      );
      return { facts: [], lines: [] };
    }
  }

  // T-0446: one compaction per (AI, chat) at a time, in memory only. The
  // gateway fires `startCompaction` after a turn's reply; it is never awaited,
  // so a slow or failed model call can neither delay nor fail the reply. The
  // daily-limit gate is re-checked here (usage can have crossed the cap since
  // the turn started) and the run never logs prompt or summary text.
  const runningCompactions = new Set<string>();

  function startCompaction(session: AiSession, chatKey: string, virtualKey: string): void {
    const key = `${session.aiId}:${chatKey}`;
    if (runningCompactions.has(key)) {
      return;
    }
    runningCompactions.add(key);
    void (async () => {
      try {
        if ((await checkDmRoundGate(session)) !== null) {
          return;
        }
        const startedAt = nowMs();
        const { built, withheld } = await compactMemory({
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
      } catch (error) {
        logger.warn(
          { err: toRedactedError(error, secretsFor(virtualKey)), aiId: session.aiId },
          'AI memory compaction failed',
        );
      } finally {
        runningCompactions.delete(key);
      }
    })();
  }

  return { loadMemoryContext, startCompaction };
}
