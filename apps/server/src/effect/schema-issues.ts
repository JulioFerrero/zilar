// The first decode message, walking the issue tree depth-first. A filter that
// returned a string keeps it on the `InvalidValue` message annotation; a
// `{ message }` on a length check does not reach it, so callers fall back to
// `SchemaError.message`. The options keep the historical variants identical.
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
