import { Exit, Schema, SchemaIssue } from 'effect';
import { ARGS_HASH_PATTERN, struct } from '@zilar/protocol';

// `action` is dotted: `domain.verb`, lowercase + underscores. Same regex the
// protocol's approval schema already enforces for similar dotted ids.
const ACTION_PATTERN = /^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/;

// A serialised `detail` blob stays under 2 KB so the audit log can never
// quietly start storing secrets, free text or big payloads.
const MAX_DETAIL_BYTES = 2 * 1024;

// We accept the few cost currencies the rest of the platform stores.
const costCurrencySchema = Schema.Literals(['EUR', 'USD']);

// `result` is a small closed set: the row must tell the reader whether the
// action succeeded, was refused by policy, or failed because of an error.
const resultSchema = Schema.Literals(['ok', 'denied', 'error']);

// Nullable ids are strings of 1 to 128 characters.
const nullableId = Schema.NullOr(
  Schema.String.pipe(Schema.check(Schema.isMinLength(1), Schema.isMaxLength(128))),
);

// Effect's `Record` does not run checks on the key schema, so both the key
// length bound (1 to 64 characters, like the old zod key schema) and the
// serialised-size bound live in one filter on the whole record. A filter that
// returns a string carries it (see `firstIssueMessage` below), unlike the
// `{ message }` option on length checks in Effect 4.0.2.
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

// The boundary validation: callers (the approvals and machines routes) hand
// us an entry, and we reject malformed ones before they touch the database.
// The spec forbids any free text: only ids, the action, a hash, optional
// cost, and a small `detail` object. `struct` (from `@zilar/protocol`) keeps
// the zod shape: mutable fields, and excess keys rejected at decode time via
// `onExcessProperty: 'error'` (see `decodeEntry`).
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

// The first decode message, like the old `parsed.error.issues[0]?.message`.
// Walks the issue tree depth-first: a filter that returned a string carries
// it on the `InvalidValue` message annotation. In Effect v4 the `{ message }`
// option on length/pattern checks does NOT reach those annotations, but the
// `SchemaError.message` already carries the filter text — so the size message
// is matched there first (a test asserts its exact text).
function firstIssueMessage(issue: SchemaIssue.Issue): string | undefined {
  switch (issue._tag) {
    case 'Composite':
    case 'AnyOf':
      for (const child of issue.issues) {
        const message = firstIssueMessage(child);
        if (message !== undefined) {
          return message;
        }
      }
      return undefined;
    case 'Pointer':
    case 'Filter':
    case 'Encoding':
      return firstIssueMessage(issue.issue);
    case 'InvalidType':
      return SchemaIssue.defaultLeafHook(issue);
    case 'MissingKey':
      return 'Missing key';
    case 'InvalidValue': {
      const message = issue.annotations?.message;
      return typeof message === 'string' && message.length > 0 ? message : undefined;
    }
    default:
      return undefined;
  }
}

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
      // A union failure (e.g. a wrong type for a nullable id) flattens to an
      // `AnyOf` with no child issues, so the tree walk finds nothing: fall
      // back to the schema message's first line (`Expected string | null`).
      throw new Error(
        `Invalid audit entry: ${firstIssueMessage(reason.error.issue) ?? reason.error.message.split('\n')[0] ?? 'unknown'}`,
      );
    }
  }
  throw new Error('Invalid audit entry: unknown');
}

function serialisedSize(value: unknown): number {
  return Buffer.byteLength(JSON.stringify(value), 'utf8');
}
