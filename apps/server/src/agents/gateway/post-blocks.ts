// T-1758: the `post_blocks` runner, split out of `tool-exec.ts` like
// `ask-people.ts`. It turns one validated call into a `blocks` card in the
// room. The AI id and room come from the live session and the turn context,
// never from the model's arguments.
import { Effect } from 'effect';
import type { Payload } from '@zilar/protocol';
import { buildBlocksPayload } from '../../message-blocks/build';
import type { RecordCardInput } from '../../message-blocks/cards';
import { INTERACTIVE_KINDS } from '../../message-blocks/guide';
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

// The room the turn runs in: where the card is posted. T-1800: `kind` is
// `chat` for the owner's DM and `groupchat` (the default) everywhere else.
export interface PostBlocksChat {
  roomJid: string;
  groupId?: string;
  topicId?: string;
  kind?: 'groupchat' | 'chat';
}

// T-1800: a group card lands in the room, a DM card in the chat with the owner.
const POSTED_TEXT_GROUP =
  'Your card was posted in this room. Do not repeat what it shows; reply with at most one short line.';
const POSTED_TEXT_CHAT =
  'Your card was posted in this chat. Do not repeat what it shows; reply with at most one short line.';
const FAILED_TEXT = 'error: the card could not be posted';
// T-1803: a DM card cannot be answered (nothing records it), so an interactive
// kind there would strand the reader; the model is told to use a read-only kind.
const INTERACTIVE_IN_DM_TEXT =
  'invalid: interactive cards work only in a group or topic; use a read-only kind here';

export function createPostBlocksRunner(
  logger: GatewayLogger,
  send: LiveSession['liveSendMessage'],
  record: (input: RecordCardInput) => Promise<void>,
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
      const kind = chat.kind ?? 'groupchat';
      const sent = await send(session, chat.roomJid, kind, payload.data.fallback, { payload });
      return { ok: true, id: sent.id };
    } catch (error) {
      return { ok: false, error };
    }
  }

  // T-1791: records the posted card so a tap can find it later. Best-effort:
  // a storage failure is logged and never changes the tool result.
  async function recordPosted(
    session: AiSession,
    chat: PostBlocksChat,
    originId: string,
    data: RecordCardInput['data'],
  ): Promise<void> {
    try {
      await record({
        originId,
        aiId: session.aiId,
        roomJid: chat.roomJid,
        ...(chat.groupId === undefined ? {} : { groupId: chat.groupId }),
        ...(chat.topicId === undefined ? {} : { topicId: chat.topicId }),
        data,
      });
    } catch (error) {
      logger.warn({ aiId: session.aiId, err: errorName(error) }, 'AI card record failed');
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
    // T-1803: an interactive card in a direct chat can never be answered, so
    // refuse it here, before anything is sent.
    const kind = chat.kind ?? 'groupchat';
    if (
      kind === 'chat' &&
      payload.data.blocks.some((block) => INTERACTIVE_KINDS.includes(block.kind))
    ) {
      logger.info(
        { aiId: session.aiId, tool: POST_BLOCKS_TOOL, ok: false },
        'AI post_blocks refused',
      );
      return { content: INTERACTIVE_IN_DM_TEXT };
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
    // T-1800: a DM card is read-only for now, so there is nothing to record;
    // a tap on it answers 404 like any other tool card.
    if (kind !== 'chat') {
      yield* Effect.promise(() => recordPosted(session, chat, posted.id, payload.data));
    }
    logger.info({ aiId: session.aiId, tool: POST_BLOCKS_TOOL, ok: true }, 'AI post_blocks posted');
    // T-1761: the card is in the room, so the group turn sends no echo reply.
    return {
      content: kind === 'chat' ? POSTED_TEXT_CHAT : POSTED_TEXT_GROUP,
      postedToRoom: true,
    };
  });

  const runPostBlocks = (
    session: AiSession,
    call: PostBlocksCall,
    chat: PostBlocksChat,
  ): Promise<ToolExecution> => Effect.runPromise(runPostBlocksEffect(session, call, chat));

  return { runPostBlocks, runPostBlocksEffect };
}
