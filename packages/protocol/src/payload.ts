import { Schema } from 'effect';
import { ApprovalDecisionSchema, ApprovalRequestSchema } from './approval';
import { AttachmentSchema } from './attachment';
import { decodeOrThrow, isValid } from './common';
import { HandoffSchema } from './handoff';
import { PollSchema, PollVoteSchema } from './poll';
import { CostSchema, PreviewSchema, ProgressSchema } from './progress';
import { StickerSchema } from './sticker';
import { BoardUpdateSchema, TaskSchema } from './task';
import { VoiceMetaSchema } from './voice';
import { WakeReasonSchema } from './wake';

export const MAX_PAYLOAD_BYTES = 64 * 1024;

export const PayloadSchema = Schema.Union([
  Schema.Struct({ v: Schema.Literal(0), type: Schema.Literal('task'), data: TaskSchema }),
  Schema.Struct({ v: Schema.Literal(0), type: Schema.Literal('handoff'), data: HandoffSchema }),
  Schema.Struct({
    v: Schema.Literal(0),
    type: Schema.Literal('approval.request'),
    data: ApprovalRequestSchema,
  }),
  Schema.Struct({
    v: Schema.Literal(0),
    type: Schema.Literal('approval.decision'),
    data: ApprovalDecisionSchema,
  }),
  Schema.Struct({ v: Schema.Literal(0), type: Schema.Literal('progress'), data: ProgressSchema }),
  Schema.Struct({
    v: Schema.Literal(0),
    type: Schema.Literal('board.update'),
    data: BoardUpdateSchema,
  }),
  Schema.Struct({ v: Schema.Literal(0), type: Schema.Literal('preview'), data: PreviewSchema }),
  Schema.Struct({ v: Schema.Literal(0), type: Schema.Literal('cost'), data: CostSchema }),
  Schema.Struct({ v: Schema.Literal(0), type: Schema.Literal('wake'), data: WakeReasonSchema }),
  Schema.Struct({ v: Schema.Literal(0), type: Schema.Literal('poll'), data: PollSchema }),
  Schema.Struct({ v: Schema.Literal(0), type: Schema.Literal('poll.vote'), data: PollVoteSchema }),
  Schema.Struct({ v: Schema.Literal(0), type: Schema.Literal('voice'), data: VoiceMetaSchema }),
  Schema.Struct({
    v: Schema.Literal(0),
    type: Schema.Literal('attachment'),
    data: AttachmentSchema,
  }),
  Schema.Struct({ v: Schema.Literal(0), type: Schema.Literal('sticker'), data: StickerSchema }),
]);

export type Payload = typeof PayloadSchema.Type;

const KNOWN_PAYLOAD_TYPES: ReadonlySet<string> = new Set(
  PayloadSchema.members.map((member) => member.fields.type.literal),
);

export type DecodePayloadResult = { ok: true; payload: Payload } | { ok: false; error: string };

function utf8ByteLength(value: string, limit: number): number {
  let bytes = 0;
  for (const character of value) {
    const codePoint = character.codePointAt(0) ?? 0;
    if (codePoint <= 0x7f) {
      bytes += 1;
    } else if (codePoint <= 0x7ff) {
      bytes += 2;
    } else if (codePoint <= 0xffff) {
      bytes += 3;
    } else {
      bytes += 4;
    }
    if (bytes > limit) {
      return bytes;
    }
  }
  return bytes;
}

export function encodePayload(payload: Payload): string {
  return JSON.stringify(decodeOrThrow(PayloadSchema)(payload));
}

export function decodePayload(raw: string): DecodePayloadResult {
  try {
    // UTF-8 bytes are never fewer than UTF-16 code units, so a longer string is always too large.
    if (
      raw.length > MAX_PAYLOAD_BYTES ||
      utf8ByteLength(raw, MAX_PAYLOAD_BYTES) > MAX_PAYLOAD_BYTES
    ) {
      return { ok: false, error: 'payload exceeds the 64 KiB limit' };
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return { ok: false, error: 'payload is not valid JSON' };
    }

    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      return { ok: false, error: 'payload must be a JSON object' };
    }

    const type = 'type' in parsed ? parsed.type : undefined;
    if (typeof type !== 'string' || !KNOWN_PAYLOAD_TYPES.has(type)) {
      return { ok: false, error: 'unknown payload type' };
    }

    const version = 'v' in parsed ? parsed.v : undefined;
    if (version !== 0) {
      return { ok: false, error: 'unsupported payload version' };
    }

    if (!isValid(PayloadSchema)(parsed)) {
      return { ok: false, error: 'payload failed schema validation' };
    }

    return { ok: true, payload: parsed };
  } catch {
    return { ok: false, error: 'payload could not be decoded' };
  }
}
