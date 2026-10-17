// T-1791: the AI's own blocks card comes back from the room as an outgoing
// reflection. Its `id` is the archive stanza id (XEP-0359) that clients quote,
// while the row was written under the origin id the gateway chose when sending,
// so a tap could never find it. Best-effort: logs the AI id and the outcome
// only, and turns every failure into a logged no-op so ingest never breaks.
//
// T-1792: the reflection can beat the insert (the send returns before the row
// is written), so a miss is retried a few times with backoff before giving up.
import { Effect } from 'effect';
import type { ChatMessage } from '@zilar/xmpp-core';
import type { ServerDatabase } from '../../db/client';
import { rekeyCard } from '../../message-blocks/cards';
import { errorName, type AiSession, type GatewayLogger } from './contracts';

// The waits between the first attempt and each retry.
const RETRY_DELAYS_MS = [300, 1000, 3000] as const;

export async function rekeyCardOnReflection(
  db: ServerDatabase,
  session: AiSession,
  message: ChatMessage,
  logger: GatewayLogger,
): Promise<void> {
  const payload = message.payload;
  const originId = message.originId;
  if (payload?.type !== 'blocks' || originId === undefined || originId === message.id) {
    return;
  }
  const rekeyed = await Effect.runPromise(
    Effect.gen(function* () {
      for (const delayMs of RETRY_DELAYS_MS) {
        const updated = yield* Effect.tryPromise(() => rekeyCard(db, originId, message.id));
        if (updated) {
          return true;
        }
        yield* Effect.sleep(delayMs);
      }
      return yield* Effect.tryPromise(() => rekeyCard(db, originId, message.id));
    }).pipe(
      Effect.orElseSucceed((error) => {
        logger.warn({ aiId: session.aiId, err: errorName(error) }, 'AI card re-key failed');
        return false;
      }),
    ),
  );
  if (rekeyed) {
    logger.info({ aiId: session.aiId }, 'AI card re-keyed');
  }
}
