// T-1579 (plan docs/audit/handoff-questions-plan.md §3e, §3f, §7 step 6): the
// answer path for a question card. Both functions run on the room message path
// and are best-effort: each logs the AI id and the outcome only, and turns every
// failure into a logged no-op so a database hiccup never breaks ingest.
import { Effect } from 'effect';
import type { ChatMessage } from '@zilar/xmpp-core';
import type { ServerDatabase } from '../../db/client';
import {
  answerQuestion,
  findOpenQuestionByMessage,
  rekeyQuestionMessage,
} from '../../questions/service';
import { normBareJid } from '../context';
import { errorName, isAiSender, type AiSession, type GatewayLogger } from './contracts';

// The stored answer is bounded, like every other stored question text.
const MAX_ANSWER_LENGTH = 200;

// T-1579: the AI's own card comes back from the room as an outgoing reflection.
// Its `id` is the archive stanza id (XEP-0359) that clients quote in
// `replyTo.id`, while the row was stamped with the origin id the gateway chose
// when sending, so a reply can never match it. Re-key the row to the stanza id.
export async function rekeyOnReflection(
  db: ServerDatabase,
  session: AiSession,
  message: ChatMessage,
  logger: GatewayLogger,
): Promise<void> {
  const payload = message.payload;
  const originId = message.originId;
  if (payload?.type !== 'question' || originId === undefined) {
    return;
  }
  const rekeyed = await Effect.runPromise(
    Effect.tryPromise(() => rekeyQuestionMessage(db, originId, message.id)).pipe(
      Effect.orElseSucceed((error) => {
        logger.warn({ aiId: session.aiId, err: errorName(error) }, 'AI question re-key failed');
        return false;
      }),
    ),
  );
  if (rekeyed) {
    logger.info({ aiId: session.aiId }, 'AI question card re-keyed');
  }
}

// T-1579: a person's reply to a question card answers (closes) it. Every AI
// session in the room receives the same stanza, so only the asking AI's session
// handles it. The first reply wins; a later one finds the row no longer open.
export async function answerOnReply(
  db: ServerDatabase,
  session: AiSession,
  message: ChatMessage,
  logger: GatewayLogger,
): Promise<void> {
  const fromBare = normBareJid(message.fromJid);
  if (isAiSender(fromBare)) {
    return;
  }
  const replyTo = message.replyTo;
  if (replyTo === undefined) {
    return;
  }
  const answered = await Effect.runPromise(
    Effect.gen(function* () {
      const question = yield* Effect.tryPromise(() => findOpenQuestionByMessage(db, replyTo.id));
      if (question === null || question.aiId !== session.aiId) {
        return false;
      }
      const nick = session.rooms.get(normBareJid(message.chatJid))?.nick;
      return yield* Effect.tryPromise(() =>
        answerQuestion(db, question.id, {
          answer: answerText(message.body ?? '', nick),
          answeredBy: fromBare,
        }),
      );
    }).pipe(
      Effect.orElseSucceed((error) => {
        logger.warn({ aiId: session.aiId, err: errorName(error) }, 'AI question answer failed');
        return false;
      }),
    ),
  );
  if (answered) {
    logger.info({ aiId: session.aiId }, 'AI question answered');
  }
}

// A chip tap sends the option with a leading `@<asking AI's nick>` mention; a
// typed reply may carry the same mention. Drop it and bound what is stored.
function answerText(body: string, nick: string | undefined): string {
  let text = body.trim();
  if (nick !== undefined && nick !== '') {
    const mention = `@${nick}`;
    if (text.startsWith(mention)) {
      text = text.slice(mention.length).trimStart();
    }
  }
  return text.slice(0, MAX_ANSWER_LENGTH);
}
