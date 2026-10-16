// T-1758: the `post_blocks` runner, split out of `tool-exec.ts` like
// `ask-people.ts`. It turns one validated call into a `blocks` card in the
// room. The AI id and room come from the live session and the turn context,
// never from the model's arguments.
import { Effect } from 'effect';
import type { Payload } from '@zilar/protocol';
import { buildBlocksPayload } from '../../message-blocks/build';
import { POST_BLOCKS_TOOL } from '../tools';
import type { ToolExecution } from '../reply';
import { errorName, type AiSession, type GatewayLogger } from './contracts';
import type { createLiveSession } from './live';

type LiveSession = ReturnType<typeof createLiveSession>;

// The validated `post_blocks` arguments the executor passes in. `blocks` is
// unchecked: `buildBlocksPayload` validates the real shapes and never throws.
export interface PostBlocksCall {
  text: string;
  title?: string;
  icon?: string;
  meta?: string;
  blocks: unknown[];
}

// The room the turn runs in: where the card is posted.
export interface PostBlocksChat {
  roomJid: string;
}

const POSTED_TEXT =
  'Your card was posted in this room. Do not repeat what it shows; reply with at most one short line.';
const FAILED_TEXT = 'error: the card could not be posted';

export function createPostBlocksRunner(
  logger: GatewayLogger,
  send: LiveSession['liveSendMessage'],
) {
  // Posts the card. A rejected `send` must be caught here: a rejected
  // `Effect.promise` inside the generator below would end the run as a defect,
  // so the await stays in this plain async function instead.
  async function postCard(
    session: AiSession,
    chat: PostBlocksChat,
    payload: Extract<Payload, { type: 'blocks' }>,
  ): Promise<{ ok: true; id: string } | { ok: false; error: unknown }> {
    try {
      const sent = await send(session, chat.roomJid, 'groupchat', payload.data.fallback, {
        payload,
      });
      return { ok: true, id: sent.id };
    } catch (error) {
      return { ok: false, error };
    }
  }

  const runPostBlocksEffect = Effect.fnUntraced(function* (
    session: AiSession,
    call: PostBlocksCall,
    chat: PostBlocksChat,
  ): Effect.fn.Return<ToolExecution> {
    const built = buildBlocksPayload(
      {
        ...(call.title === undefined ? {} : { title: call.title }),
        ...(call.icon === undefined ? {} : { icon: call.icon }),
        ...(call.meta === undefined ? {} : { meta: call.meta }),
        blocks: call.blocks,
      },
      call.text,
    );
    // A bad card is fixable, so the model gets the short reason and can retry.
    if (!built.ok) {
      logger.info(
        { aiId: session.aiId, tool: POST_BLOCKS_TOOL, ok: false },
        'AI post_blocks refused',
      );
      return { content: `invalid: ${built.reason}` };
    }
    const payload = built.payload;
    // `buildBlocksPayload` only ever returns a `blocks` payload; the guard is
    // for the type system, and the model sees the same failure if it is wrong.
    if (payload.type !== 'blocks') {
      return { content: FAILED_TEXT };
    }
    const posted = yield* Effect.promise(() => postCard(session, chat, payload));
    if (!posted.ok) {
      logger.warn(
        { aiId: session.aiId, tool: POST_BLOCKS_TOOL, err: errorName(posted.error) },
        'AI post_blocks failed',
      );
      return { content: FAILED_TEXT };
    }
    // An empty id means the stop kill-switch dropped the send: nothing was
    // posted, so the model is told the post failed.
    if (posted.id === '') {
      logger.warn(
        { aiId: session.aiId, tool: POST_BLOCKS_TOOL, ok: false },
        'AI post_blocks failed',
      );
      return { content: FAILED_TEXT };
    }
    logger.info({ aiId: session.aiId, tool: POST_BLOCKS_TOOL, ok: true }, 'AI post_blocks posted');
    // T-1761: the card is in the room, so the group turn sends no echo reply.
    return { content: POSTED_TEXT, postedToRoom: true };
  });

  const runPostBlocks = (
    session: AiSession,
    call: PostBlocksCall,
    chat: PostBlocksChat,
  ): Promise<ToolExecution> => Effect.runPromise(runPostBlocksEffect(session, call, chat));

  return { runPostBlocks, runPostBlocksEffect };
}
