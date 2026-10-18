import { Effect } from 'effect';
import type { Block, Payload } from '@zilar/protocol';
import type { CardMediaRow } from '../../db/rows-agents';
import { buildBlocksPayload } from '../../message-blocks/build';
import type { RecordCardInput } from '../../message-blocks/cards';
import { mediaIdsOf } from '../../message-blocks/media-ids';
import { POST_BLOCKS_TOOL } from '../tools/schemas';
import type { ToolExecution } from '../tool-loop';
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

// The room the turn runs in: where the card is posted. `kind` is `chat` for
// the owner's DM and `groupchat` (the default) everywhere else.
export interface PostBlocksChat {
  roomJid: string;
  groupId?: string;
  topicId?: string;
  kind?: 'groupchat' | 'chat';
}

function postedText(id: string, where: 'this room' | 'this chat'): string {
  return `Your card was posted in ${where} (card id ${id}). Do not repeat what it shows; reply with at most one short line.`;
}
const FAILED_TEXT = 'error: the card could not be posted';
const UNKNOWN_MEDIA_TEXT = 'invalid: unknown media';

export function createPostBlocksRunner(
  logger: GatewayLogger,
  send: LiveSession['liveSendMessage'],
  record: (input: RecordCardInput) => Promise<void>,
  lookupMedia: (id: string) => Promise<CardMediaRow | undefined>,
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

  // Records the posted card so a tap can find it later. Best-effort: a storage
  // failure is logged and never changes the tool result.
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

  // A card may only carry media this AI fetched into this chat. A
  // missing row, another AI's row and another chat's row all answer the same
  // reason, so the model cannot probe ids. A lookup failure is not a verdict:
  // the caller reports it like any other failed post.
  async function checkMedia(
    session: AiSession,
    chat: PostBlocksChat,
    blocks: readonly Block[],
  ): Promise<'allowed' | 'unknown' | 'failed'> {
    const chatKey = chat.kind === 'chat' ? session.aiJid : chat.roomJid;
    try {
      for (const id of mediaIdsOf(blocks)) {
        const row = await lookupMedia(id);
        if (row === undefined || row.aiId !== session.aiId) {
          return 'unknown';
        }
        if (row.roomJid.toLowerCase() !== chatKey.toLowerCase()) {
          return 'unknown';
        }
      }
      return 'allowed';
    } catch (error) {
      logger.warn(
        { aiId: session.aiId, tool: POST_BLOCKS_TOOL, err: errorName(error) },
        'AI post_blocks media lookup failed',
      );
      return 'failed';
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
    const verdict = yield* Effect.promise(() => checkMedia(session, chat, payload.data.blocks));
    if (verdict === 'failed') {
      return { content: FAILED_TEXT };
    }
    if (verdict === 'unknown') {
      logger.info(
        { aiId: session.aiId, tool: POST_BLOCKS_TOOL, ok: false },
        'AI post_blocks refused',
      );
      return { content: UNKNOWN_MEDIA_TEXT };
    }
    const kind = chat.kind ?? 'groupchat';
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
    // A DM card is never reflected, so it keeps the sent id and is recorded
    // there too; the owner answers it, anyone else gets 404.
    yield* Effect.promise(() => recordPosted(session, chat, posted.id, payload.data));
    logger.info({ aiId: session.aiId, tool: POST_BLOCKS_TOOL, ok: true }, 'AI post_blocks posted');
    return {
      content: postedText(posted.id, kind === 'chat' ? 'this chat' : 'this room'),
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
