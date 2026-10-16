// T-1765: the production port the tool adapters and the routine scheduler
// post through. It answers `false` while the agent gateway does not exist
// yet (during startup and on follower instances), and forwards the whole
// post — the text and the optional card payload — once it does. Dropping
// `payload` here is the live bug this file fixes: `tool.run` and tool
// routines posted plain text instead of their card.
import { Effect } from 'effect';
import type { AgentGateway } from '../agents/gateway';
import type { BuildToolAdaptersDeps } from '../tools/adapter-support';

export function postAsAi(
  getGateway: () => Pick<AgentGateway, 'postToChat'> | null,
): BuildToolAdaptersDeps['post'] {
  return ({ aiId, groupId, topicId, text, payload }) => {
    const gateway = getGateway();
    if (gateway === null) {
      return Effect.runPromise(Effect.succeed(false));
    }
    return gateway.postToChat({
      aiId,
      groupId,
      ...(topicId === undefined ? {} : { topicId }),
      text,
      ...(payload === undefined ? {} : { payload }),
    });
  };
}
