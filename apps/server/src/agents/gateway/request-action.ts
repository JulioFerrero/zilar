import { Effect } from 'effect';
import type { ActionGateway, RequestOutcome } from '../../actions/gateway';
import { REQUEST_ACTION_TOOL } from '../tools';
import type { ToolExecution, ValidToolCall } from '../reply';
import {
  denialReasonForModel,
  errorName,
  formatModelText,
  type AiSession,
  type GatewayLogger,
} from './contracts';

type RequestActionCall = Extract<ValidToolCall, { tool: typeof REQUEST_ACTION_TOOL }>;
type RequestActionChat = { groupId: string; topicId: string };

// Routes a `request_action` call into the action gateway. The ai id and chat
// ids always come from the session, never from the call: a model that smuggles
// `aiId` or `groupId` inside `args` cannot change who is asked. No adapter text
// beyond the success `summary` reaches the AI. The group context adjusts the
// pending wording ("in this chat" vs "in this room") and tags the group and
// topic ids.
export function createRequestActionRunner(
  actions: ActionGateway | undefined,
  logger: GatewayLogger,
) {
  const runRequestActionEffect = Effect.fnUntraced(function* (
    session: AiSession,
    call: RequestActionCall,
    chat?: RequestActionChat,
    unattended?: boolean,
  ): Effect.fn.Return<ToolExecution> {
    if (actions === undefined) {
      return { content: 'invalid: unknown tool: request_action' };
    }
    const outcome = yield* Effect.promise(() =>
      actions.request({
        aiId: session.aiId,
        ...(chat === undefined ? {} : { groupId: chat.groupId, topicId: chat.topicId }),
        action: call.action,
        args: call.args,
        requestedBy: session.aiJid,
        // A scheduled (unattended) run runs tier 0/1 and refuses a tier-2
        // request without a standing rule instead of parking a card.
        ...(unattended === true ? { unattended: true } : {}),
      }),
    ).pipe(
      Effect.catchDefect((error) =>
        // The gateway is best-effort: a thrown error here would mean a bug
        // we cannot leak. Log the class name only and answer as failed.
        Effect.sync((): RequestOutcome | null => {
          logger.warn(
            { err: errorName(error), aiId: session.aiId, action: call.action },
            'action gateway request threw',
          );
          return null;
        }),
      ),
    );
    if (outcome === null) {
      return { content: 'the action failed' };
    }
    switch (outcome.status) {
      case 'executed':
        return {
          content: `done: ${outcome.summary}${formatModelText(outcome.modelText)}`,
          // The adapter posted the answer into the room itself (a `blocks`
          // card), so the group turn sends no echo reply.
          ...(outcome.posted === true ? { postedToRoom: true } : {}),
        };
      case 'pending_approval':
        // The card is the owner's view; the model gets a short fixed line. In
        // groups only admins, owners and the AI's owner get the buttons. The
        // approval id rides along so the session log can record it.
        return {
          content:
            chat === undefined
              ? "waiting for your owner's approval; a card was posted in this chat"
              : "waiting for an admin's approval; a card was posted in this room",
          approvalId: outcome.approvalId,
        };
      case 'failed':
        return { content: 'the action failed' };
      case 'denied':
        return { content: `denied: ${denialReasonForModel(outcome.reason)}` };
    }
  });

  const runRequestAction = (
    session: AiSession,
    call: RequestActionCall,
    chat?: RequestActionChat,
    unattended?: boolean,
  ): Promise<ToolExecution> =>
    Effect.runPromise(runRequestActionEffect(session, call, chat, unattended));

  return { runRequestAction, runRequestActionEffect };
}
