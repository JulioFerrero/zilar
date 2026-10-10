// Shared schema-issue walker (T-1057, dedup F6): the first decode message, like
// the old `parsed.error.issues[0]?.message`, collected here from the local
// copies in auth, routines and the xmpp admin client. Audit keeps its own, since
// it also handles `InvalidType` and `MissingKey` at every level.
//
// Walks the issue tree depth-first: a filter that returned a string carries it
// on the `InvalidValue` message annotation (the control-character case). In
// Effect v4 the `{ message }` option on `isMinLength`/`isMaxLength` does NOT
// reach those annotations, but the `SchemaError.message` first line already
// carries the exact text (empty / overlong names). A missing key or a non-string
// name falls back to the caller's default.
import { SchemaIssue } from 'effect';

export function firstIssueMessage(issue: SchemaIssue.Issue): string | undefined {
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
    case 'InvalidValue': {
      const message = issue.annotations?.message;
      return typeof message === 'string' && message.length > 0 ? message : undefined;
    }
    default:
      return undefined;
  }
}
