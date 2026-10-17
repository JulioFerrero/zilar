// T-1880: every run of a routine linked to an alert card rewrites the card's
// note to when it last checked and the value it saw, then corrects the message
// in the room. A quiet run (T-1878) posts nothing, so this note is the only
// sign the check is running. The refresh is best-effort: a missing card, a
// card of another AI, an unreadable block or a failed correction is logged
// with the routine id and swallowed, so the run's outcome never depends on
// the card.
import { Option, Schema } from 'effect';
import { BlocksDataSchema, type BlocksData } from '@zilar/protocol';
import type { ServerDatabase } from '../db/client';
import type { RoutineRow } from '../db/rows';
import { findCard, saveCardData } from '../message-blocks/cards';
import type { CorrectCardInput } from '../message-blocks/respond';
import { describeSchedule } from '../tools/routine-adapters';
import { parseRoutineSchedule } from './schedule';

// The alert block's `note` is `ShortText` (`MAX_SHORT` in the protocol).
const MAX_NOTE_CHARS = 40;

export interface AlertNotePorts {
  correctCard?: (input: CorrectCardInput) => Promise<boolean>;
}

export interface AlertNoteLogger {
  warn: (fields: Record<string, unknown>, message: string) => void;
}

export interface RefreshAlertNoteInput {
  db: ServerDatabase;
  ports: AlertNotePorts;
  row: RoutineRow;
  value: number;
  logger: AlertNoteLogger;
}

// `Checked every 5 minutes · now 82,302`, cut to the note's 40 characters. A
// long schedule loses its tail, never the value: the value is what moved.
function noteFor(schedule: string, value: number): string {
  const tail = ` · now ${value.toLocaleString('en-US')}`;
  const head = `Checked ${schedule}`;
  const room = MAX_NOTE_CHARS - tail.length - 1;
  const cut = head.length <= room ? head : `${head.slice(0, Math.max(0, room))}…`;
  return `${cut}${tail}`.slice(0, MAX_NOTE_CHARS);
}

export async function refreshAlertNote(input: RefreshAlertNoteInput): Promise<void> {
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
    // The card must be the routine's own AI's, even if a future path links one
    // without running the `routine.schedule` ownership check.
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
