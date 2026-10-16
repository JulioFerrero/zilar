import { Exit, Schema } from 'effect';
import { type Payload, BlocksDataSchema, encodePayload } from '@zilar/protocol';
import { firstIssueReason } from '../agents/tool-arg-issues';

// The blocks an AI or a saved tool produced, before they are checked. `blocks`
// is `unknown` on purpose: it is decoded and validated here, not by the caller.
export type BlocksInput = {
  title?: unknown;
  icon?: unknown;
  meta?: unknown;
  blocks: unknown;
};

// Turns unchecked blocks into a checked `blocks` payload, or a short reason the
// model can read. Never throws. Called by the `post_blocks` AI tool (B6) and by
// saved-tool and routine output (B7).
export function buildBlocksPayload(
  input: BlocksInput,
  fallback: string,
): { ok: true; payload: Payload } | { ok: false; reason: string } {
  const trimmed = fallback.trim().slice(0, 1000);
  if (trimmed.length === 0) {
    return { ok: false, reason: 'fallback text is required' };
  }

  // Keys that are `undefined` are dropped so an absent `title` is not read as
  // an excess key by the strict decode below.
  const candidate: Record<string, unknown> = { fallback: trimmed };
  for (const key of ['title', 'icon', 'meta', 'blocks'] as const) {
    const value = input[key];
    if (value !== undefined) {
      candidate[key] = value;
    }
  }

  const exit = Schema.decodeUnknownExit(BlocksDataSchema, {
    errors: 'all',
    onExcessProperty: 'error',
  })(candidate);
  if (!Exit.isSuccess(exit)) {
    for (const reason of exit.cause.reasons) {
      if (reason._tag === 'Fail') {
        const message = firstIssueReason(reason.error.issue, candidate);
        if (message !== undefined) {
          return { ok: false, reason: message };
        }
      }
    }
    return { ok: false, reason: 'invalid blocks' };
  }

  const payload: Payload = { v: 0, type: 'blocks', data: exit.value };
  try {
    encodePayload(payload);
  } catch {
    return { ok: false, reason: 'blocks payload is too large' };
  }
  return { ok: true, payload };
}
