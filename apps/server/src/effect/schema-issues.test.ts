import { describe, expect, it } from 'vitest';
import { Exit, Schema, SchemaIssue } from 'effect';
import { firstIssueMessage } from './schema-issues';

// Decoding a small schema the way the callers do, and keeping the issue tree
// so every option is checked against a real Effect issue.
function failedIssue<S extends Schema.ConstraintDecoder<unknown>>(
  schema: S,
  input: unknown,
): SchemaIssue.Issue {
  const exit = Schema.decodeUnknownExit(schema, { errors: 'all' })(input);
  if (Exit.isSuccess(exit)) {
    throw new Error('expected the schema to fail');
  }
  for (const reason of exit.cause.reasons) {
    if (reason._tag === 'Fail') {
      return reason.error.issue;
    }
  }
  throw new Error('expected a Fail reason');
}

const nonEmptyName = Schema.String.pipe(
  Schema.check(Schema.makeFilter((value) => (value.length > 0 ? undefined : 'must not be empty'))),
);

const silentFilter = Schema.String.pipe(
  Schema.check(Schema.makeFilter(() => false, { message: 'filter annotation' })),
);

describe('firstIssueMessage', () => {
  it('returns the first annotated message by default', () => {
    const issue = failedIssue(Schema.Struct({ name: nonEmptyName }), { name: '' });

    expect(firstIssueMessage(issue)).toBe('must not be empty');
  });

  it('reads the filter annotation only with filterAnnotations', () => {
    const issue = failedIssue(silentFilter, 'anything');

    expect(firstIssueMessage(issue)).toBeUndefined();
    expect(firstIssueMessage(issue, { filterAnnotations: true })).toBe('filter annotation');
  });

  it('names InvalidType and MissingKey leaves only with leafTypes', () => {
    const invalidType = failedIssue(Schema.Number, 'many');
    expect(firstIssueMessage(invalidType)).toBeUndefined();
    expect(invalidType._tag).toBe('InvalidType');
    if (invalidType._tag === 'InvalidType') {
      expect(firstIssueMessage(invalidType, { leafTypes: true })).toBe(
        SchemaIssue.defaultLeafHook(invalidType),
      );
    }

    const missingKey = failedIssue(Schema.Struct({ name: Schema.String }), {});
    expect(firstIssueMessage(missingKey)).toBeUndefined();
    expect(firstIssueMessage(missingKey, { leafTypes: true })).toBe('Missing key');
  });

  it('follows only the first Composite child with firstChildOnly', () => {
    const schema = Schema.Struct({ first: Schema.Number, second: nonEmptyName });
    const issue = failedIssue(schema, { first: 'many', second: '' });

    expect(firstIssueMessage(issue)).toBe('must not be empty');
    expect(firstIssueMessage(issue, { firstChildOnly: true })).toBeUndefined();
  });

  it('stays silent on AnyOf with firstChildOnly', () => {
    const issue = failedIssue(Schema.Union([nonEmptyName, Schema.Number]), '');

    expect(firstIssueMessage(issue)).toBe('must not be empty');
    expect(firstIssueMessage(issue, { firstChildOnly: true })).toBeUndefined();
  });
});
