// T-1409 review: the `request_action` runner split out of `tool-exec.ts` so no
// gateway file exceeds the 400-line cap. A pure move: the wording and behaviour
// are unchanged.
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
// `aiId` or `groupId` inside `args` cannot change who is asked. The mapping
// below is the exact model-facing wording per outcome (see spec); no adapter
// text beyond the success `summary` reaches the AI. The group context (when
// present) adjusts the pending-approval wording — owners see "in this chat",
// admins see "in this room" — and tags the request with the room's group and
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
      // No action gateway wired: the tool was never offered, so this call
      // is treated as an unknown tool and answered honestly.
      return { content: 'invalid: unknown tool: request_action' };
    }
    const outcome = yield* Effect.promise(() =>
      actions.request({
        aiId: session.aiId,
        ...(chat === undefined ? {} : { groupId: chat.groupId, topicId: chat.topicId }),
        action: call.action,
        args: call.args,
        requestedBy: session.aiJid,
        // T-1655: a scheduled (unattended) run. The gateway runs tier 0/1 as
        // usual and refuses a tier-2 request without a standing rule with
        // `needs_approval` instead of parking a card.
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
        return { content: `done: ${outcome.summary}${formatModelText(outcome.modelText)}` };
      case 'pending_approval':
        // The card message is the owner's view; the model just gets a
        // short fixed line so it knows to wait. The wording differs by
        // chat: in DMs the card appears in the owner's chat, in groups
        // it appears in the room and only group admins / owners / the
        // AI's owner get the buttons. T-1530: the approval id travels
        // with the result so the session log can record it.
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
