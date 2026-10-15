// T-1576: the `ask_people` runner, split out of `tool-exec.ts` like
// `request-action.ts`. It turns one validated call into an `ai_questions` row
// and a question card in the room, then stamps the card's message id on the
// still-open row. The AI id, room, group and topic all come from the live
// session and the turn context, never from the model's arguments.
import { Effect } from 'effect';
import type { Question } from '@zilar/protocol';
import type { ServerDatabase } from '../../db/client';
import type { AiQuestionRow } from '../../db/rows';
import { HttpError } from '../../errors';
import { createQuestion, expireQuestion, setQuestionMessageId } from '../../questions/service';
import { ASK_PEOPLE_TOOL } from '../tools';
import type { ToolExecution } from '../reply';
import { errorName, type AiSession, type GatewayLogger } from './contracts';
import type { createLiveSession } from './live';

type LiveSession = ReturnType<typeof createLiveSession>;

// The validated `ask_people` arguments the executor passes in. They are the
// `ValidToolCall` member's fields; the service validates them again.
export interface AskPeopleCall {
  question: string;
  options: string[];
}

// The room the turn runs in: where the card is posted and the ids stored on the
// question row. All of it comes from the session and the turn context.
export interface AskPeopleChat {
  groupId: string;
  topicId: string;
  roomJid: string;
}

// The card's fallback text: the question, then one `n. option` line per option,
// so a client that cannot render the payload still shows a usable card.
function fallbackText(question: string, options: string[]): string {
  return [question, ...options.map((option, index) => `${index + 1}. ${option}`)].join('\n');
}

// The model-facing texts, and the only ones: success, the per-AI cap, and any
// other failure. Logs carry the AI id and the outcome only, never the text.
const POSTED_TEXT =
  'Your question was posted. The people here will answer in this room; wait for their reply.';
const TOO_MANY_TEXT = 'invalid: too many open questions';
const FAILED_TEXT = 'error: the question could not be posted';

type Created = { ok: true; row: AiQuestionRow } | { ok: false; tooMany: boolean; error: unknown };

export function createAskPeopleRunner(
  db: ServerDatabase,
  logger: GatewayLogger,
  send: LiveSession['liveSendMessage'],
) {
  function create(session: AiSession, call: AskPeopleCall, chat: AskPeopleChat): Promise<Created> {
    return createQuestion(db, {
      aiId: session.aiId,
      groupId: chat.groupId,
      ...(chat.topicId === '' ? {} : { topicId: chat.topicId }),
      roomJid: chat.roomJid,
      question: call.question,
      options: call.options,
    }).then(
      (row): Created => ({ ok: true, row }),
      (error: unknown): Created => ({
        ok: false,
        tooMany: error instanceof HttpError && error.code === 'too_many_questions',
        error,
      }),
    );
  }

  // Posts the card and stamps its id. Anything that fails here leaves the row
  // `open` with a null message id — invisible to every read, but still counted
  // by the per-AI cap — so it is expired to refund the slot. An empty id means
  // the stop kill-switch dropped the send: nothing was posted, so the model is
  // told the post failed instead of a card it will never see.
  async function postCard(
    session: AiSession,
    row: AiQuestionRow,
    chat: AskPeopleChat,
  ): Promise<{ ok: true } | { ok: false; error: unknown }> {
    const payload: Question = {
      id: row.id,
      ai: session.aiJid,
      question: row.question,
      options: row.options,
    };
    try {
      const sent = await send(
        session,
        chat.roomJid,
        'groupchat',
        fallbackText(row.question, row.options),
        { payload: { v: 0, type: 'question', data: payload } },
      );
      if (sent.id === '') {
        await expireQuestion(db, row.id);
        return { ok: false, error: new Error('question card was not sent') };
      }
      await setQuestionMessageId(db, row.id, sent.id);
      return { ok: true };
    } catch (error) {
      await expireQuestion(db, row.id);
      return { ok: false, error };
    }
  }

  const runAskPeopleEffect = Effect.fnUntraced(function* (
    session: AiSession,
    call: AskPeopleCall,
    chat: AskPeopleChat,
  ): Effect.fn.Return<ToolExecution> {
    const created = yield* Effect.promise(() => create(session, call, chat));
    if (!created.ok) {
      if (created.tooMany) {
        logger.info(
          { aiId: session.aiId, tool: ASK_PEOPLE_TOOL, ok: false },
          'AI ask_people refused',
        );
        return { content: TOO_MANY_TEXT };
      }
      logger.warn(
        { aiId: session.aiId, tool: ASK_PEOPLE_TOOL, err: errorName(created.error) },
        'AI ask_people failed',
      );
      return { content: FAILED_TEXT };
    }
    const posted = yield* Effect.promise(() => postCard(session, created.row, chat));
    if (!posted.ok) {
      logger.warn(
        { aiId: session.aiId, tool: ASK_PEOPLE_TOOL, err: errorName(posted.error) },
        'AI ask_people failed',
      );
      return { content: FAILED_TEXT };
    }
    logger.info({ aiId: session.aiId, tool: ASK_PEOPLE_TOOL, ok: true }, 'AI ask_people posted');
    return { content: POSTED_TEXT };
  });

  const runAskPeople = (
    session: AiSession,
    call: AskPeopleCall,
    chat: AskPeopleChat,
  ): Promise<ToolExecution> => Effect.runPromise(runAskPeopleEffect(session, call, chat));

  return { runAskPeople, runAskPeopleEffect };
}
