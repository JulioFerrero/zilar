import { Effect } from 'effect';
import {
  GROUP_RATE_WINDOW_MS,
  GROUP_TURNS_PER_WINDOW,
  ROUND_MAX_AI_TURNS,
  type RoomRound,
} from './contracts';

// T-1176 (AI-7): the two room turn limits, moved out of `group-turn.ts` (which
// was over the 400-line rule). One function answers which limit a turn hit; it
// keeps the same bookkeeping the inline checks had: the per-AI `roomTurns`
// stamps are recorded for every accepted turn and the stamp is refunded when
// the shared round budget drops the turn.
export type RoomLimitResult = 'ok' | 'rate' | 'round';

// The fixed text a rate-limited AI sends at most once per AI per room per
// window. The asker's name is prefixed as an `@` mention by the caller.
export const ROOM_RATE_LIMIT_NOTICE =
  "I've answered a lot here in the last few minutes. Please try again shortly.";

export interface RoomLimitsInput {
  /** Per-AI turn stamps (ms) per room, from the AI session. */
  roomTurns: Map<string, number[]>;
  /** Per-room round budgets, shared by every AI in the room. */
  roomRounds: Map<string, RoomRound>;
  roomJid: string;
  /** The turn's clock (`nowMs`). */
  atMs: number;
}

export function checkRoomLimits(input: RoomLimitsInput): RoomLimitResult {
  const { roomTurns, roomRounds, roomJid, atMs } = input;
  const recent = (roomTurns.get(roomJid) ?? []).filter(
    (stamp) => stamp > atMs - GROUP_RATE_WINDOW_MS,
  );
  if (recent.length >= GROUP_TURNS_PER_WINDOW) {
    roomTurns.set(roomJid, recent);
    return 'rate';
  }
  recent.push(atMs);
  roomTurns.set(roomJid, recent);
  // T-0479: at most ROUND_MAX_AI_TURNS AI turns per human message per room,
  // across every AI that message woke. The rate stamp just pushed is refunded
  // so a dropped turn does not consume rate budget. A missing round (for
  // example right after a restart) counts as a fresh one.
  const round = roomRounds.get(roomJid);
  if (round !== undefined && round.aiTurns >= ROUND_MAX_AI_TURNS) {
    recent.pop();
    roomTurns.set(roomJid, recent);
    return 'round';
  }
  if (round !== undefined) {
    round.aiTurns += 1;
  }
  return 'ok';
}

// T-1176 (AI-7): one notice per AI per room per rate window. The stamp of the
// last notice lives on the session (in memory; a restart may repeat one), and
// a further drop inside the same window stays silent.
export interface RateNoticeInput {
  notices: Map<string, number>;
  roomJid: string;
  atMs: number;
  askerName: string;
  send: (text: string) => Promise<unknown>;
}

export function shouldSendRateNotice(
  notices: Map<string, number>,
  roomJid: string,
  atMs: number,
): boolean {
  const last = notices.get(roomJid);
  return last === undefined || atMs - last >= GROUP_RATE_WINDOW_MS;
}

export const sendRoomRateNotice = Effect.fnUntraced(function* (
  input: RateNoticeInput,
): Effect.fn.Return<void> {
  if (!shouldSendRateNotice(input.notices, input.roomJid, input.atMs)) {
    return;
  }
  // The stamp is set before the send: a failed notice never repeats inside the
  // window, matching "one message per window".
  input.notices.set(input.roomJid, input.atMs);
  yield* Effect.promise(() => input.send(`@${input.askerName} ${ROOM_RATE_LIMIT_NOTICE}`));
});
