import { Exit, Schema } from 'effect';
import { ARGS_HASH_PATTERN, struct } from '@zilar/protocol';
import { firstIssueMessage } from '../effect/schema-issues';

// `action` is dotted: `domain.verb`, lowercase and underscores.
const ACTION_PATTERN = /^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/;

// A serialised `detail` stays under 2 KB, so the log cannot quietly store secrets or
// big payloads.
const MAX_DETAIL_BYTES = 2 * 1024;

const costCurrencySchema = Schema.Literals(['EUR', 'USD']);

const resultSchema = Schema.Literals(['ok', 'denied', 'error']);

const nullableId = Schema.NullOr(
  Schema.String.pipe(Schema.check(Schema.isMinLength(1), Schema.isMaxLength(128))),
);

// Effect's `Record` runs no checks on the key schema, so the key length (1 to 64)
// and the serialised size bound live in one filter on the whole record.
const detailSchema = Schema.NullOr(
  Schema.Record(Schema.String, Schema.Unknown).pipe(
    Schema.check(
      Schema.makeFilter((value) => {
        for (const key of Object.keys(value)) {
          if (key.length < 1 || key.length > 64) {
            return 'detail keys must be 1 to 64 characters';
          }
        }
        return serialisedSize(value) <= MAX_DETAIL_BYTES
          ? undefined
          : `detail must serialise to at most ${MAX_DETAIL_BYTES} bytes`;
      }),
    ),
  ),
);

// Boundary validation: malformed entries are rejected before touching the database.
// Only ids, the action, a hash, optional cost and a small `detail` are allowed.
const entrySchema = struct({
  actorUserId: nullableId,
  aiId: nullableId,
  groupId: nullableId,
  action: Schema.String.pipe(
    Schema.check(Schema.isPattern(ACTION_PATTERN), Schema.isMaxLength(100)),
  ),
  subjectId: nullableId,
  argsHash: Schema.NullOr(Schema.String.pipe(Schema.check(Schema.isPattern(ARGS_HASH_PATTERN)))),
  costCurrency: Schema.NullOr(costCurrencySchema),
  costAmount: Schema.NullOr(Schema.Finite.pipe(Schema.check(Schema.isGreaterThanOrEqualTo(0)))),
  result: resultSchema,
  detail: detailSchema,
});

export type AuditEntry = typeof entrySchema.Type;

export function decodeEntry(entry: AuditEntry): AuditEntry {
  const exit = Schema.decodeUnknownExit(entrySchema, {
    errors: 'all',
    onExcessProperty: 'error',
  })(entry);
  if (Exit.isSuccess(exit)) {
    return exit.value;
  }
  for (const reason of exit.cause.reasons) {
    if (reason._tag === 'Fail') {
      const sizeText = `detail must serialise to at most ${MAX_DETAIL_BYTES} bytes`;
      if (reason.error.message.includes(sizeText)) {
        throw new Error(`Invalid audit entry: ${sizeText}`);
      }
      // A union failure flattens to an `AnyOf` with no child issues, so fall back to the
      // schema message's first line.
      throw new Error(
        `Invalid audit entry: ${firstIssueMessage(reason.error.issue, { leafTypes: true }) ?? reason.error.message.split('\n')[0] ?? 'unknown'}`,
      );
    }
  }
  throw new Error('Invalid audit entry: unknown');
}

function serialisedSize(value: unknown): number {
  return Buffer.byteLength(JSON.stringify(value), 'utf8');
}
