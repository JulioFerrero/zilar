import { SchemaIssue } from 'effect';

// The type name a missing key's `Invalid input: expected …, received
// undefined` reason uses. Every key in the model tool schemas is a string
// except `request_action`'s `args`, which is a record.
const MISSING_KEY_TYPE: Readonly<Record<string, string>> = { args: 'record' };

// Turns Effect's issue tree into one short reason for the model. The reason
// comes only from keys, schema tags and code-written annotations: a value is
// never read into the text (`raw` is inspected for its runtime type name
// only), so persona text or an action argument can never leak through a
// rejection. Returns `undefined` when no branch applies; the caller then uses
// its own generic reason.
export function firstIssueReason(
  issue: SchemaIssue.Issue,
  raw?: unknown,
  path: ReadonlyArray<PropertyKey> = [],
): string | undefined {
  switch (issue._tag) {
    case 'Composite':
    case 'AnyOf':
      for (const child of issue.issues) {
        const reason = firstIssueReason(child, raw, path);
        if (reason !== undefined) {
          return reason;
        }
      }
      return undefined;
    case 'Pointer': {
      const key = issue.path.at(-1);
      const child =
        typeof raw === 'object' && raw !== null && key !== undefined
          ? (raw as Record<PropertyKey, unknown>)[key]
          : undefined;
      return firstIssueReason(issue.issue, child, [...path, ...issue.path]);
    }
    case 'Filter':
      return filterReason(issue, path) ?? firstIssueReason(issue.issue, raw, path);
    case 'Encoding':
      return firstIssueReason(issue.issue, raw, path);
    case 'MissingKey': {
      const message = issue.annotations?.messageMissingKey;
      if (typeof message === 'string' && message.length > 0) {
        return message;
      }
      const expected =
        path.length === 0 ? 'object' : (MISSING_KEY_TYPE[String(path.at(-1) ?? '')] ?? 'string');
      return `Invalid input: expected ${expected}, received undefined`;
    }
    case 'UnexpectedKey':
      return `Unrecognized key: "${String(path.at(-1) ?? '?')}"`;
    case 'InvalidType': {
      const expected =
        issue.ast._tag === 'Objects' && path.length > 0 && path.at(-1) === 'args'
          ? 'record'
          : astTypeName(issue.ast._tag);
      return `Invalid input: expected ${expected}, received ${rawTypeName(raw)}`;
    }
    case 'InvalidValue': {
      const message = issue.annotations?.message;
      return typeof message === 'string' && message.length > 0 ? message : undefined;
    }
    default:
      return undefined;
  }
}

function astTypeName(tag: string): string {
  switch (tag) {
    case 'String':
      return 'string';
    case 'Number':
      return 'number';
    case 'Boolean':
      return 'boolean';
    case 'Arrays':
      return 'array';
    case 'Objects':
      return 'object';
    default:
      return 'value';
  }
}

function rawTypeName(raw: unknown): string {
  if (raw === null) {
    return 'null';
  }
  if (Array.isArray(raw)) {
    return 'array';
  }
  return typeof raw;
}

// A filter carries its own text in `expected` ("a value with a length of at
// most 4000"); the field name is prepended so the model sees where it failed.
// The value itself is never included.
function filterReason(
  issue: SchemaIssue.Filter,
  path: ReadonlyArray<PropertyKey>,
): string | undefined {
  const annotations = issue.filter.annotations;
  const message = annotations?.message;
  if (typeof message === 'string' && message.length > 0) {
    return message;
  }
  const expected = annotations?.expected;
  if (typeof expected === 'string' && expected.length > 0) {
    return `${fieldName(path)}: ${expected}`;
  }
  return undefined;
}

function fieldName(path: ReadonlyArray<PropertyKey>): string {
  let out = '';
  for (const segment of path) {
    out +=
      typeof segment === 'number'
        ? `[${segment}]`
        : out === ''
          ? String(segment)
          : `.${String(segment)}`;
  }
  return out === '' ? 'arguments' : out;
}
