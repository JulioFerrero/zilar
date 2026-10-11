// The Effect Schema body rules for first-run setup, split out of `setup/api.ts`
// in T-1120 with no behaviour change.

import { Schema, SchemaGetter, SchemaIssue } from 'effect';

// zod v4's practical email check (`z.email()`), kept so an address the setup
// page accepted before is still accepted.
const EMAIL_PATTERN =
  /^(?:[A-Za-z0-9_'+-]+\.)*[A-Za-z0-9_'+-]*[A-Za-z0-9_+-]@(?:[A-Za-z0-9][A-Za-z0-9-]*\.)+[A-Za-z]{2,}$/;

// Replaces `field: z.string().trim().min(1, ...).max(n, ...)`: trimmed before
// the length checks, exactly like the old chain. In effect 4.0.2 the
// `{ message }` option on `isMinLength`/`isMaxLength` does not reach the issue
// annotations, so one `makeFilter` returns each text (T-0561 pitfall).
function lengthChecked(field: string, max: number): (value: string) => string | undefined {
  return (value) => {
    if (value.length < 1) {
      return `${field} must not be empty`;
    }
    if (value.length > max) {
      return `${field} must be at most ${max} characters`;
    }
    return undefined;
  };
}

const ResendApiKey = Schema.Trim.pipe(
  Schema.check(Schema.makeFilter(lengthChecked('resendApiKey', 256))),
);

const From = Schema.Trim.pipe(Schema.check(Schema.makeFilter(lengthChecked('from', 320))));

// Replaces `z.string().trim().toLowerCase()`: trimmed, then lowercased, before
// the checks below run.
const Lowercased = Schema.Trim.pipe(
  Schema.decodeTo(Schema.String, {
    decode: SchemaGetter.transform((value: string) => value.toLowerCase()),
    encode: SchemaGetter.transform((value: string) => value),
  }),
);

// Replaces the `adminEmail` chain: trim, lowercase, min 1, max 320, then the
// email rule, with the same texts in the same order.
const AdminEmail = Lowercased.pipe(
  Schema.check(
    Schema.makeFilter((value: string) => {
      if (value.length < 1) {
        return 'adminEmail must not be empty';
      }
      if (value.length > 320) {
        return 'adminEmail must be at most 320 characters';
      }
      if (!EMAIL_PATTERN.test(value)) {
        return 'adminEmail must be a valid email address';
      }
      return undefined;
    }),
  ),
);

export const SetupBody = Schema.Struct({
  resendApiKey: ResendApiKey,
  from: From,
  adminEmail: AdminEmail,
});

export const SetupStatus = Schema.Struct({
  needsSetup: Schema.Boolean,
  mailConfigured: Schema.Boolean,
});

export const SetupResult = Schema.Struct({
  ok: Schema.Boolean,
  inviteCode: Schema.String,
});

// The first failure's message, like zod's `issues[0].message`: a `makeFilter`
// text when the failing check set one, else the generic fallback. A returned
// string from a `makeFilter` predicate becomes the `message` annotation of its
// inner `InvalidValue` issue.
export function firstMessage(issue: SchemaIssue.Issue): string | undefined {
  switch (issue._tag) {
    case 'Composite': {
      const first = issue.issues[0];
      return first === undefined ? undefined : firstMessage(first);
    }
    case 'Pointer':
    case 'Encoding':
    case 'Filter':
      return firstMessage(issue.issue);
    case 'InvalidValue': {
      const message = issue.annotations?.message;
      return typeof message === 'string' && message.length > 0 ? message : undefined;
    }
    default:
      return undefined;
  }
}
