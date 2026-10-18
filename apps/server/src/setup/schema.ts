import { Schema, SchemaGetter, SchemaIssue } from 'effect';
import { firstIssueMessage } from '../effect/schema-issues';

// A pragmatic email check: an address the setup page accepted stays accepted.
const EMAIL_PATTERN =
  /^(?:[A-Za-z0-9_'+-]+\.)*[A-Za-z0-9_'+-]*[A-Za-z0-9_+-]@(?:[A-Za-z0-9][A-Za-z0-9-]*\.)+[A-Za-z]{2,}$/;

// Trimmed before the length checks. In effect 4.0.2 the `{ message }` option on
// `isMinLength`/`isMaxLength` does not reach the issue annotations, so one `makeFilter`
// returns each text.
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

const Lowercased = Schema.Trim.pipe(
  Schema.decodeTo(Schema.String, {
    decode: SchemaGetter.transform((value: string) => value.toLowerCase()),
    encode: SchemaGetter.transform((value: string) => value),
  }),
);

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

// The first failure's message: a `makeFilter` text when one is set, else the fallback.
export function firstMessage(issue: SchemaIssue.Issue): string | undefined {
  return firstIssueMessage(issue, { firstChildOnly: true });
}
