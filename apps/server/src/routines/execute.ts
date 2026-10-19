import { Effect, Option, Schema } from 'effect';
import { SqlClient } from 'effect/sql';
import { type Payload, BlocksDataSchema, type BlocksData } from '@zilar/protocol';
import { type AuditRecorder } from '../audit/recorder';
import { type ServerDatabase } from '../db/client';
import { runSql } from '../effect/sql';
import { type CorrectCardInput } from '../message-blocks/respond';
import { fieldOf } from '../message-blocks/apply';
import { isSubsetOf } from '../tools/adapter-support';
import { type ToolRunner } from '../tools/types';
import { executePromptRoutine, type PromptRunner } from './execute-prompt';
import {
  markOk,
  markSkipped,
  pauseForFailures,
  pauseForHostsChanged,
  postResult,
  recordFailure,
} from './outcomes';
import { type TopicRow, allowedTopicAiIds } from '../topics/access';
import { findCard, saveCardData } from '../message-blocks/cards';
import { describeSchedule } from '../tools/routine-adapters';
import { parseRoutineSchedule } from './schedule';
import { type RoutineRow } from '../db/rows-agents';
import { runToolVersion } from '../tools/runner';
import { ToolServiceError } from '../tools/queries';
// The alert block's `note` is `ShortText` (`MAX_SHORT`).
const MAX_NOTE_CHARS = 40;

interface AlertNotePorts {
  correctCard?: (input: CorrectCardInput) => Promise<boolean>;
}

interface AlertNoteLogger {
  warn: (fields: Record<string, unknown>, message: string) => void;
}

interface RefreshAlertNoteInput {
  db: ServerDatabase;
  ports: AlertNotePorts;
  row: RoutineRow;
  value: number;
  logger: AlertNoteLogger;
}

// Cut to the note's 40 characters; a long schedule loses its tail, never the value.
function noteFor(schedule: string, value: number): string {
  const tail = ` · now ${value.toLocaleString('en-US')}`;
  const head = `Checked ${schedule}`;
  const room = MAX_NOTE_CHARS - tail.length - 1;
  const cut = head.length <= room ? head : `${head.slice(0, Math.max(0, room))}…`;
  return `${cut}${tail}`.slice(0, MAX_NOTE_CHARS);
}

async function refreshAlertNote(input: RefreshAlertNoteInput): Promise<void> {
  const { db, ports, row, value, logger } = input;
  const cardId = row.alertCardId;
  const blockId = row.alertBlockId;
  if (cardId === null || blockId === null) {
    return;
  }
  try {
    const parsed = parseRoutineSchedule(row.schedule);
    if (!parsed.ok) {
      logger.warn({ routineId: row.id }, 'alert routine schedule unreadable');
      return;
    }
    const card = await findCard(db, cardId);
    if (card === null) {
      logger.warn({ routineId: row.id }, 'alert card missing');
      return;
    }
    // The card must be the routine's own AI's, even if a future path links one without the ownership check.
    if (card.aiId !== row.aiId) {
      logger.warn({ routineId: row.id }, 'alert card belongs to another AI');
      return;
    }
    const decoded = Schema.decodeUnknownOption(BlocksDataSchema)(card.data);
    if (Option.isNone(decoded)) {
      logger.warn({ routineId: row.id }, 'alert card data unreadable');
      return;
    }
    if (!decoded.value.blocks.some((block) => block.kind === 'alert' && block.id === blockId)) {
      logger.warn({ routineId: row.id }, 'alert block missing from card');
      return;
    }
    const note = noteFor(describeSchedule(parsed.value), value);
    const data: BlocksData = {
      ...decoded.value,
      blocks: decoded.value.blocks.map((block) =>
        block.kind === 'alert' && block.id === blockId ? { ...block, note } : block,
      ),
    };
    const saved = await saveCardData(db, card.originId, data);
    if (!saved) {
      logger.warn({ routineId: row.id }, 'alert card not saved');
      return;
    }
    const correct = ports.correctCard;
    if (correct === undefined) {
      return;
    }
    const corrected = await correct({
      aiId: card.aiId,
      roomJid: card.roomJid,
      originalId: card.originId,
      text: data.fallback,
      payload: { v: 0, type: 'blocks', data },
    });
    if (!corrected) {
      logger.warn({ routineId: row.id }, 'alert card correction not sent');
    }
  } catch {
    logger.warn({ routineId: row.id }, 'alert note refresh failed');
  }
}

interface ToolVersionHostsRow {
  hosts: string[];
}

interface GroupAiRow {
  aiId: string;
}

type TopicRoomRow = Pick<TopicRow, 'id' | 'groupId' | 'visibility' | 'isGeneral' | 'archivedAt'>;

// General topics read `group_ais`; other topics follow `allowedTopicAiIds`, so the tool never runs for an AI that may have left.
// An archived topic's room is gone, so the routine skips.
async function isAiInTopicRoom(db: ServerDatabase, row: RoutineRow): Promise<boolean> {
  const [topic] = await runSql(
    db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql<TopicRoomRow>`SELECT id, group_id, visibility, is_general, archived_at
        FROM topics
        WHERE id = ${row.topicId as string}
        LIMIT 1`;
    }),
  );
  if (!topic || topic.archivedAt !== null) {
    return false;
  }
  if (topic.isGeneral) {
    const [match] = await runSql(
      db,
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        return yield* sql<GroupAiRow>`SELECT ai_id FROM group_ais
          WHERE group_id = ${row.groupId as string} AND ai_id = ${row.aiId}
          LIMIT 1`;
      }),
    );
    return match !== undefined;
  }
  return (await allowedTopicAiIds(db, topic)).has(row.aiId);
}

async function readCurrentHosts(
  db: ServerDatabase,
  toolId: string,
  currentVersion: number,
): Promise<string[] | null> {
  const [version] = await runSql(
    db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql<ToolVersionHostsRow>`SELECT hosts FROM ai_tool_versions
        WHERE tool_id = ${toolId} AND version = ${currentVersion}
        LIMIT 1`;
    }),
  );
  return version ? [...version.hosts] : null;
}

// A routine linked to an alert card reads the tool's `output.data.value` and compares it with `input.threshold`.
// Below it the run stays `ok` and silent; at or above it posts; a missing number on either side is a failure.
type AlertVerdict =
  { kind: 'post'; value: number } | { kind: 'quiet'; value: number } | { kind: 'error' };

function finiteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function alertVerdict(input: unknown, data: unknown): AlertVerdict {
  const value = finiteNumber(fieldOf(data, 'value'));
  const threshold = finiteNumber(fieldOf(input, 'threshold'));
  if (value === null || threshold === null) {
    return { kind: 'error' };
  }
  return value >= threshold ? { kind: 'post', value } : { kind: 'quiet', value };
}

export type { RoutineRow };

interface AiStatusRow {
  status: string;
}

interface ToolRow {
  deletedAt: Date | null;
  currentVersion: number;
}

export interface ExecuteRoutinePorts {
  runTool: ToolRunner;
  // Posts as the AI; `false` = not posted.
  post: (input: {
    aiId: string;
    groupId: string | null;
    topicId?: string;
    text: string;
    payload?: Payload;
  }) => Promise<boolean>;
  // The gateway's scheduled prompt turn; absent means the run is recorded `skipped`.
  runPrompt?: PromptRunner;
  // Corrects the linked alert card in the room; absent = no send.
  correctCard?: (input: CorrectCardInput) => Promise<boolean>;
}

export interface RoutineRunLogger {
  warn: (fields: Record<string, unknown>, message: string) => void;
}

export interface ExecuteRoutineOptions {
  db: ServerDatabase;
  now?: () => Date;
  audit: AuditRecorder;
  logger: RoutineRunLogger;
  // How long to wait before the one post retry. Defaults to 30 s.
  postRetryDelayMs?: number;
  // Sleep seam for the post retry (tests pass a fake).
  sleep?: (ms: number) => Promise<void>;
}

// A post during the AI's reconnect answers `false`; one retry after this wait catches the next connection.
export const POST_RETRY_DELAY_MS = 30_000;

export function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function executeRoutine(
  ports: ExecuteRoutinePorts,
  row: RoutineRow,
  options: ExecuteRoutineOptions,
): Promise<void> {
  const db = options.db;
  const now = options.now ?? (() => new Date());
  const sleep = options.sleep ?? defaultSleep;
  const postRetryDelayMs = options.postRetryDelayMs ?? POST_RETRY_DELAY_MS;
  const startedAt = Date.now();
  const at = now();

  // Step 1: the AI must be active and, for a topic routine, still in the room; a personal routine relies on `post` answering `false`.
  const [ai] = await runSql(
    db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql<AiStatusRow>`SELECT status FROM ais WHERE id = ${row.aiId} LIMIT 1`;
    }),
  );
  if (!ai || ai.status !== 'active') {
    await markSkipped(db, options, row, at, startedAt);
    return;
  }
  if (row.topicId !== null && !(await isAiInTopicRoom(db, row))) {
    await markSkipped(db, options, row, at, startedAt);
    return;
  }

  // A prompt routine needs no tool; it shares the AI/room preflight and then takes its own path.
  if (row.kind === 'prompt') {
    await executePromptRoutine(ports, row, options, at, startedAt);
    return;
  }

  // Step 2: the tool must exist (not deleted).
  const toolId = row.toolId;
  if (toolId === null) {
    // A `kind = 'tool'` routine with no tool fails like a deleted tool.
    await pauseForFailures(db, options, ports, row, at, startedAt, true);
    return;
  }
  const [tool] = await runSql(
    db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql<ToolRow>`SELECT deleted_at, current_version FROM ai_tools WHERE id = ${toolId} LIMIT 1`;
    }),
  );
  if (!tool || tool.deletedAt !== null) {
    await pauseForFailures(db, options, ports, row, at, startedAt, true);
    return;
  }

  // Step 3: fewer hosts or a code-only change keep running; a new host pauses before any run.
  const currentHosts = await readCurrentHosts(db, toolId, tool.currentVersion);
  if (currentHosts === null) {
    await pauseForFailures(db, options, ports, row, at, startedAt, true);
    return;
  }
  if (!isSubsetOf(currentHosts, row.approvedHosts)) {
    await pauseForHostsChanged(db, options, ports, row, at, startedAt);
    return;
  }

  let outputText: string | null = null;
  let outputBlocks: unknown = undefined;
  let outputCard: unknown = undefined;
  let outputData: unknown = undefined;
  try {
    const { result } = await runToolVersion(
      { db, runner: ports.runTool },
      { toolId, input: row.input ?? null, trigger: 'routine' },
      at,
    );
    if (!result.ok) {
      await recordFailure(db, options, ports, row, at, startedAt);
      return;
    }
    outputText = result.output.text;
    outputBlocks = result.output.blocks;
    outputCard = result.output.card;
    outputData = result.output.data;
  } catch (error) {
    // `ai_not_active` and `not_found` between checks and the run become skips; anything else is a run failure.
    if (error instanceof ToolServiceError && error.errorCode === 'ai_not_active') {
      await markSkipped(db, options, row, at, startedAt);
      return;
    }
    if (error instanceof ToolServiceError && error.errorCode === 'not_found') {
      await pauseForFailures(db, options, ports, row, at, startedAt, true);
      return;
    }
    options.logger.warn({ routineId: row.id }, 'routine tool runner threw');
    await recordFailure(db, options, ports, row, at, startedAt);
    return;
  }

  // A linked alert card reads the numeric value; no number is a failure, below the threshold is `ok` and silent.
  if (row.alertCardId != null) {
    const verdict = alertVerdict(row.input, outputData);
    if (verdict.kind === 'error') {
      await recordFailure(db, options, ports, row, at, startedAt);
      return;
    }
    // The note says when it last checked and what it saw; a failed refresh never changes the outcome.
    await refreshAlertNote({
      db,
      ports,
      row,
      value: verdict.value,
      logger: options.logger,
    });
    if (verdict.kind === 'quiet') {
      await markOk(db, options, row, at, startedAt);
      return;
    }
  }

  // Step 5: post as the AI; `false` or a throw means stopped or out of the room, so retry once before `skipped`.
  let posted = await postResult(ports, options, row, outputText, outputBlocks, outputCard);
  if (!posted) {
    await sleep(postRetryDelayMs);
    posted = await postResult(ports, options, row, outputText, outputBlocks, outputCard);
  }
  if (!posted) {
    await markSkipped(db, options, row, at, startedAt);
    return;
  }
  await markOk(db, options, row, at, startedAt);
}
