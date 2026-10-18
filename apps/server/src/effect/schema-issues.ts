// Shared schema-issue walker (T-1057, dedup F6): the first decode message, like
// the old `parsed.error.issues[0]?.message`, used by auth, routines, tools,
// audit, setup and the xmpp admin client.
//
// Walks the issue tree depth-first. In Effect v4 a filter that returned a string
// carries it on the `InvalidValue` message annotation, while `{ message }` on
// length checks does not reach it: callers fall back to `SchemaError.message`.
// The options keep the four historical variants identical:
// - `filterAnnotations`: read a `Filter`'s own annotation first (routines, tools);
// - `leafTypes`: name `InvalidType` and `MissingKey` leaves (audit);
// - `firstChildOnly`: only the first `Composite` child, silent on `AnyOf` (setup).
import { SchemaIssue } from 'effect';

export interface FirstIssueMessageOptions {
  filterAnnotations?: boolean;
  leafTypes?: boolean;
  firstChildOnly?: boolean;
}

export function firstIssueMessage(
  issue: SchemaIssue.Issue,
  options: FirstIssueMessageOptions = {},
): string | undefined {
  switch (issue._tag) {
    case 'Composite':
      if (options.firstChildOnly === true) {
        const first = issue.issues[0];
        return first === undefined ? undefined : firstIssueMessage(first, options);
      }
      return firstChildMessage(issue.issues, options);
    case 'AnyOf':
      return options.firstChildOnly === true ? undefined : firstChildMessage(issue.issues, options);
    case 'Pointer':
    case 'Encoding':
      return firstIssueMessage(issue.issue, options);
    case 'Filter': {
      const message = issue.filter.annotations?.message;
      if (typeof message === 'string' && message.length > 0 && options.filterAnnotations === true) {
        return message;
      }
      return firstIssueMessage(issue.issue, options);
    }
    case 'InvalidValue': {
      const message = issue.annotations?.message;
      return typeof message === 'string' && message.length > 0 ? message : undefined;
    }
    case 'InvalidType':
      return options.leafTypes === true ? SchemaIssue.defaultLeafHook(issue) : undefined;
    case 'MissingKey':
      return options.leafTypes === true ? 'Missing key' : undefined;
    default:
      return undefined;
  }
}

function firstChildMessage(
  issues: ReadonlyArray<SchemaIssue.Issue>,
  options: FirstIssueMessageOptions,
): string | undefined {
  for (const child of issues) {
    const message = firstIssueMessage(child, options);
    if (message !== undefined) {
      return message;
    }
  }
  return undefined;
}
