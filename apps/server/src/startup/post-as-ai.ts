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
