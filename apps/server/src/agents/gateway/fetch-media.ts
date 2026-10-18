// Every failure is a fixed `error:` line: a refusal's reason is already fixed
// text, and a store failure is caught here. Log lines carry the AI id, the tool
// name, the outcome and the fixed reason only, never the URL.
import { Effect } from 'effect';
import { fetchCardMedia, type FetchCardMediaResult } from '../../card-media/fetch';
import { FETCH_MEDIA_TOOL } from '../tools/schemas';
import type { ToolExecution } from '../tool-loop';
import { type AgentGatewayDeps, type AiSession } from './contracts';

export interface FetchMediaCall {
  url: string;
  kind: 'image' | 'file';
  name?: string;
}

// The chat's media key: the room JID in a group turn, the AI's own JID in the
// owner's DM. `groupId` and `topicId` ride along for the media rows' scoping.
export interface FetchMediaChat {
  roomJid: string;
  groupId?: string;
  topicId?: string;
}

const NOT_AVAILABLE_TEXT = 'error: media is not available';
const NOT_AVAILABLE_REASON = 'media is not available';
const STORE_FAILED_REASON = 'the file could not be stored';

const FORMAT_BY_MIME: Readonly<Record<string, string>> = {
  'image/png': 'PNG',
  'image/jpeg': 'JPEG',
  'image/webp': 'WEBP',
  'application/pdf': 'PDF',
  'text/csv': 'CSV',
  'text/plain': 'TXT',
};

function humanSize(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  const kilobytes = bytes / 1024;
  if (kilobytes < 1024) {
    return `${Math.round(kilobytes)} KB`;
  }
  return `${Math.round((kilobytes / 1024) * 10) / 10} MB`;
}

function fetchedText(media: {
  id: string;
  mime: string;
  size: number;
  width?: number;
  height?: number;
  name: string;
}): string {
  const format = FORMAT_BY_MIME[media.mime] ?? 'FILE';
  const dimensions =
    media.width === undefined || media.height === undefined
      ? ''
      : `, ${media.width}×${media.height}`;
  return (
    `fetched: media id ${media.id}, name ${media.name}, size ${humanSize(media.size)}, ` +
    `format ${format}${dimensions}. Put the id in an images or file block.`
  );
}

function logOutcome(
  logger: AgentGatewayDeps['logger'],
  aiId: string,
  ok: boolean,
  reason?: string,
): void {
  logger.info(
    { aiId, tool: FETCH_MEDIA_TOOL, ok, ...(reason === undefined ? {} : { reason }) },
    'AI fetch_media',
  );
}

const runFetchMediaEffect = Effect.fnUntraced(function* (
  deps: AgentGatewayDeps,
  session: AiSession,
  call: FetchMediaCall,
  chat: FetchMediaChat,
): Effect.fn.Return<ToolExecution> {
  const dir = deps.cardMediaDir;
  if (dir === undefined) {
    logOutcome(deps.logger, session.aiId, false, NOT_AVAILABLE_REASON);
    return { content: NOT_AVAILABLE_TEXT };
  }
  // A rejection is a non-quota store failure; a refusal comes back as
  // `{ ok: false, reason }` with fixed text. Both end as one `error:` line.
  const result = yield* Effect.tryPromise({
    try: () =>
      fetchCardMedia(
        { db: deps.db, dir },
        {
          aiId: session.aiId,
          roomJid: chat.roomJid,
          groupId: chat.groupId ?? null,
          topicId: chat.topicId ?? null,
          url: call.url,
          kind: call.kind,
          ...(call.name === undefined ? {} : { name: call.name }),
        },
      ),
    catch: (): FetchCardMediaResult => ({ ok: false, reason: STORE_FAILED_REASON }),
  }).pipe(Effect.catch((failed) => Effect.succeed(failed)));
  if (!result.ok) {
    logOutcome(deps.logger, session.aiId, false, result.reason);
    return { content: `error: ${result.reason}` };
  }
  logOutcome(deps.logger, session.aiId, true);
  return { content: fetchedText(result.media) };
});

export function runFetchMedia(
  deps: AgentGatewayDeps,
  session: AiSession,
  call: FetchMediaCall,
  chat: FetchMediaChat,
): Promise<ToolExecution> {
  return Effect.runPromise(runFetchMediaEffect(deps, session, call, chat));
}
