// Every failure is a fixed `error:` line. Log lines carry the AI id, the tool
// name, the outcome and the fixed reason only, never the content.
import { Data, Effect, type Effect as EffectType } from 'effect';
import { CardMediaQuotaError, storeCardMedia } from '../../card-media/service';
import type { CardMediaRow } from '../../db/rows-agents';
import { SAVE_TEXT_MEDIA_TOOL, type SaveTextMediaFormat } from '../tools/schemas';
import type { ToolExecution } from '../tool-loop';
import type { AgentGatewayDeps, AiSession } from './contracts';
import { humanSize, type FetchMediaChat } from './fetch-media';

export interface SaveTextMediaCall {
  name: string;
  format: SaveTextMediaFormat;
  content: string;
}

const TEXT_MEDIA_MAX_BYTES = 65_536;

const MIME_BY_FORMAT: Readonly<Record<SaveTextMediaFormat, string>> = {
  csv: 'text/csv',
  txt: 'text/plain',
  md: 'text/markdown',
  json: 'application/json',
};

const REFUSED_JSON = 'the content is not valid JSON';
const REFUSED_TOO_LARGE = 'the file is too large';
const REFUSED_QUOTA = 'media quota reached';
const REFUSED_STORE = 'the file could not be stored';
const NOT_AVAILABLE = 'media is not available';

class InvalidJson extends Data.TaggedError('InvalidJson') {}

type StoreOutcome = { ok: true; row: CardMediaRow } | { ok: false; reason: string };

// The display name only: the bytes are stored under a server-made UUID. The
// format extension is added when missing, and the name is reduced to the same
// conservative character set `fetch.ts` uses for a URL segment.
function displayName(raw: string, format: SaveTextMediaFormat): string {
  const suffix = `.${format}`;
  const trimmed = raw.trim();
  const base = (trimmed.toLowerCase().endsWith(suffix) ? trimmed.slice(0, -suffix.length) : trimmed)
    .replace(/[^A-Za-z0-9._ -]/g, '')
    .trim();
  const capped = base.slice(0, 100 - suffix.length);
  return `${capped === '' ? 'file' : capped}${suffix}`;
}

function savedText(row: CardMediaRow, format: SaveTextMediaFormat): string {
  return (
    `saved: media id ${row.id}, name ${row.name}, size ${humanSize(row.size)}, ` +
    `format ${format.toUpperCase()}. Put the id in a file block.`
  );
}

function logOutcome(
  logger: AgentGatewayDeps['logger'],
  aiId: string,
  ok: boolean,
  reason?: string,
): void {
  logger.info(
    { aiId, tool: SAVE_TEXT_MEDIA_TOOL, ok, ...(reason === undefined ? {} : { reason }) },
    'AI save_text_media',
  );
}

const runSaveTextMediaEffect = Effect.fnUntraced(function* (
  deps: AgentGatewayDeps,
  session: AiSession,
  call: SaveTextMediaCall,
  chat: FetchMediaChat,
): EffectType.fn.Return<ToolExecution> {
  const dir = deps.cardMediaDir;
  if (dir === undefined) {
    logOutcome(deps.logger, session.aiId, false, NOT_AVAILABLE);
    return { content: `error: ${NOT_AVAILABLE}` };
  }
  if (call.format === 'json') {
    const valid = yield* Effect.match(
      Effect.try({ try: () => JSON.parse(call.content), catch: () => new InvalidJson() }),
      { onFailure: () => false, onSuccess: () => true },
    );
    if (!valid) {
      logOutcome(deps.logger, session.aiId, false, REFUSED_JSON);
      return { content: `error: ${REFUSED_JSON}` };
    }
  }
  const bytes = new TextEncoder().encode(call.content);
  if (bytes.byteLength > TEXT_MEDIA_MAX_BYTES) {
    logOutcome(deps.logger, session.aiId, false, REFUSED_TOO_LARGE);
    return { content: `error: ${REFUSED_TOO_LARGE}` };
  }

  // The store enforces the caps under a per-AI advisory lock, so a refusal
  // writes nothing. Its quota error is the only expected failure.
  const stored = yield* Effect.match(
    Effect.tryPromise({
      try: () =>
        storeCardMedia(deps.db, dir, {
          aiId: session.aiId,
          roomJid: chat.roomJid,
          groupId: chat.groupId ?? null,
          topicId: chat.topicId ?? null,
          mime: MIME_BY_FORMAT[call.format],
          name: displayName(call.name, call.format),
          bytes,
        }),
      catch: (error) => (error instanceof CardMediaQuotaError ? REFUSED_QUOTA : REFUSED_STORE),
    }),
    {
      onFailure: (reason): StoreOutcome => ({ ok: false, reason }),
      onSuccess: (row): StoreOutcome => ({ ok: true, row }),
    },
  );
  if (!stored.ok) {
    logOutcome(deps.logger, session.aiId, false, stored.reason);
    return { content: `error: ${stored.reason}` };
  }

  logOutcome(deps.logger, session.aiId, true);
  return { content: savedText(stored.row, call.format) };
});

export function runSaveTextMedia(
  deps: AgentGatewayDeps,
  session: AiSession,
  call: SaveTextMediaCall,
  chat: FetchMediaChat,
): Promise<ToolExecution> {
  return Effect.runPromise(runSaveTextMediaEffect(deps, session, call, chat));
}
