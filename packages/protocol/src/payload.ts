import { z } from 'zod';
import { ApprovalDecisionSchema, ApprovalRequestSchema } from './approval';
import { HandoffSchema } from './handoff';
import { PollSchema, PollVoteSchema } from './poll';
import { CostSchema, PreviewSchema, ProgressSchema } from './progress';
import { BoardUpdateSchema, TaskSchema } from './task';
import { VoiceMetaSchema } from './voice';
import { WakeReasonSchema } from './wake';

export const MAX_PAYLOAD_BYTES = 64 * 1024;

export const PayloadSchema = z.discriminatedUnion('type', [
  z.strictObject({ v: z.literal(0), type: z.literal('task'), data: TaskSchema }),
  z.strictObject({ v: z.literal(0), type: z.literal('handoff'), data: HandoffSchema }),
  z.strictObject({
    v: z.literal(0),
    type: z.literal('approval.request'),
    data: ApprovalRequestSchema,
  }),
  z.strictObject({
    v: z.literal(0),
    type: z.literal('approval.decision'),
    data: ApprovalDecisionSchema,
  }),
  z.strictObject({ v: z.literal(0), type: z.literal('progress'), data: ProgressSchema }),
  z.strictObject({ v: z.literal(0), type: z.literal('board.update'), data: BoardUpdateSchema }),
  z.strictObject({ v: z.literal(0), type: z.literal('preview'), data: PreviewSchema }),
  z.strictObject({ v: z.literal(0), type: z.literal('cost'), data: CostSchema }),
  z.strictObject({ v: z.literal(0), type: z.literal('wake'), data: WakeReasonSchema }),
  z.strictObject({ v: z.literal(0), type: z.literal('poll'), data: PollSchema }),
  z.strictObject({ v: z.literal(0), type: z.literal('poll.vote'), data: PollVoteSchema }),
  z.strictObject({ v: z.literal(0), type: z.literal('voice'), data: VoiceMetaSchema }),
]);

export type Payload = z.infer<typeof PayloadSchema>;

const KNOWN_PAYLOAD_TYPES: ReadonlySet<string> = new Set(
  PayloadSchema.options.map((option) => option.shape.type.value),
);

export type DecodePayloadResult = { ok: true; payload: Payload } | { ok: false; error: string };

function utf8ByteLength(value: string): number {
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
  }
  return bytes;
}

export function encodePayload(payload: Payload): string {
  return JSON.stringify(PayloadSchema.parse(payload));
}

export function decodePayload(raw: string): DecodePayloadResult {
  try {
    if (utf8ByteLength(raw) > MAX_PAYLOAD_BYTES) {
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

    const result = PayloadSchema.safeParse(parsed);
    if (!result.success) {
      return { ok: false, error: 'payload failed schema validation' };
    }

    return { ok: true, payload: result.data };
  } catch {
    return { ok: false, error: 'payload could not be decoded' };
  }
}
