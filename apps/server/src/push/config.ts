import { Effect, Exit, Schema, SchemaGetter, SchemaIssue } from 'effect';

// Push (web push through ejabberd's mod_push) configuration. Everything is
// optional so the server boots without push; the routes answer 404 and the
// component stays off unless `PUSH_ENABLED=true`. When enabled, the VAPID
// keys, the component credentials and the storage key must all be present —
// the wiring in `app.ts`/`index.ts` refuses to start half-configured.

const toInt = SchemaGetter.transform((value: string) => Number.parseInt(value, 10));
const toText = SchemaGetter.transform((value: number) => String(value));

// A key that is absent (or `undefined`) falls back to `fallback`, matching
// zod's `.default()` / preprocess `?? default` behaviour, and the decoded type
// has the key required.
function withDefault<S extends Schema.Constraint>(schema: S, fallback: S['Encoded']) {
  return Schema.withDecodingDefaultKey<S>(Effect.succeed(fallback))(schema);
}

// `'true'`/`'false'` string flag decoded to a boolean; anything else is invalid.
function booleanFlagSchema() {
  return Schema.Literals(['true', 'false']).pipe(
    Schema.withDecodingDefaultKey(Effect.succeed('false')),
    Schema.decodeTo(Schema.Boolean, {
      decode: SchemaGetter.transform((value: 'true' | 'false') => value === 'true'),
      encode: SchemaGetter.transform((value: boolean) => (value ? 'true' : 'false')),
    }),
  );
}

const nonEmptyStringSchema = Schema.String.pipe(Schema.check(Schema.isMinLength(1)));

const pushEnvSchema = Schema.Struct({
  PUSH_ENABLED: booleanFlagSchema(),
  PUSH_VAPID_PUBLIC_KEY: Schema.optional(nonEmptyStringSchema),
  PUSH_VAPID_PRIVATE_KEY: Schema.optional(nonEmptyStringSchema),
  PUSH_VAPID_SUBJECT: Schema.optional(nonEmptyStringSchema),
  PUSH_COMPONENT_JID: Schema.optional(nonEmptyStringSchema),
  PUSH_COMPONENT_SECRET: Schema.optional(nonEmptyStringSchema),
  PUSH_COMPONENT_PORT: withDefault(
    Schema.String.pipe(
      Schema.check(Schema.isPattern(/^\d+$/)),
      Schema.decodeTo(Schema.Int, { decode: toInt, encode: toText }),
      Schema.check(Schema.isGreaterThanOrEqualTo(1)),
      Schema.check(Schema.isLessThanOrEqualTo(65535)),
    ),
    '5347',
  ),
  // Host of ejabberd's XEP-0114 component listener (T-0172). Compose sets
  // `ejabberd` (the service name); dev keeps the 127.0.0.1 default. A
  // scheme, port or path would build a broken service URL, so anything but
  // letters, digits, dots and hyphens fails startup with the fixed message
  // below (the value is never echoed).
  PUSH_COMPONENT_HOST: withDefault(
    Schema.String.pipe(
      Schema.check(
        Schema.isPattern(/^[A-Za-z0-9.-]+$/, {
          message: 'PUSH_COMPONENT_HOST must be a plain hostname (letters, digits, dots, hyphens)',
        }),
      ),
    ),
    '127.0.0.1',
  ),
  // Seals the Web Push subscription keys at rest (AES-256-GCM). At least 32
  // characters, like the provider-key master key. Rotating it orphans
  // existing rows: the component drops (never sends from) undecryptable
  // devices, and the device list invites re-enabling.
  PUSH_STORAGE_KEY: Schema.optional(Schema.String.pipe(Schema.check(Schema.isMinLength(32)))),
});

export type PushConfig = Schema.Schema.Type<typeof pushEnvSchema>;

// Names the variables an invalid push env failed on. Only the key names are
// kept, never a value, so a secret pasted into the wrong variable can never
// reach a log or an error.
class PushConfigError extends Error {
  readonly failedKeys: ReadonlyArray<string>;

  constructor(failedKeys: ReadonlyArray<string>) {
    super('Invalid push configuration');
    this.name = 'PushConfigError';
    this.failedKeys = failedKeys;
  }
}

// Collects the struct-key paths of every failed field: `missing` for an
// absent required key, the field name for anything else.
function failedKeysOf(
  issue: SchemaIssue.Issue,
  path: ReadonlyArray<PropertyKey> = [],
): ReadonlyArray<string> {
  switch (issue._tag) {
    case 'Composite':
      return issue.issues.flatMap((child) => failedKeysOf(child, path));
    case 'Pointer':
      return failedKeysOf(issue.issue, [...path, ...issue.path]);
    case 'Filter':
    case 'Encoding':
      return failedKeysOf(issue.issue, path);
    default:
      return [path.join('.')];
  }
}

// Docker Compose renders an unset optional as an empty string (`${VAR:-}`),
// which the schema would reject: an empty `PUSH_*` value means "not set".
function emptyPushSettingsAsUnset(
  env: Record<string, string | undefined>,
): Record<string, string | undefined> {
  const normalized = { ...env };
  for (const key of Object.keys(normalized)) {
    if (key.startsWith('PUSH_') && normalized[key] === '') {
      delete normalized[key];
    }
  }
  return normalized;
}

export function loadPushConfig(env: Record<string, string | undefined>): PushConfig {
  const exit = Schema.decodeUnknownExit(pushEnvSchema, { errors: 'all' })(
    emptyPushSettingsAsUnset(env),
  );
  if (Exit.isSuccess(exit)) {
    return exit.value;
  }
  const failedKeys: string[] = [];
  for (const reason of exit.cause.reasons) {
    if (reason._tag === 'Fail') {
      failedKeys.push(...failedKeysOf(reason.error.issue));
    }
  }
  const defect = exit.cause.reasons.find((reason) => reason._tag === 'Die');
  if (failedKeys.length === 0 && defect !== undefined && defect._tag === 'Die') {
    throw defect.defect;
  }
  throw new PushConfigError(failedKeys);
}

// Like the server's `loadServerConfigOrExit`: an invalid push host refuses
// to boot with one fixed message that names the variable, never its value
// (a secret could be pasted there by mistake). Called before `createApp` so
// no route or component starts on a broken config.
export function loadPushConfigOrExit(env: Record<string, string | undefined>): PushConfig {
  try {
    return loadPushConfig(env);
  } catch (error) {
    const hostInvalid =
      error instanceof PushConfigError && error.failedKeys.includes('PUSH_COMPONENT_HOST');
    if (!hostInvalid) {
      throw error;
    }
    console.error(
      'Invalid push configuration: PUSH_COMPONENT_HOST must be a plain hostname (letters, digits, dots, hyphens)',
    );
    process.exit(1);
  }
}

// The enabled config, or null with the reason named when `PUSH_ENABLED=true`
// but a required value is missing. Values are never echoed: the reason names
// the variable, not its content.
export function pushConfigError(config: PushConfig): string | null {
  if (!config.PUSH_ENABLED) {
    return null;
  }
  const missing: string[] = [];
  if (config.PUSH_VAPID_PUBLIC_KEY === undefined) {
    missing.push('PUSH_VAPID_PUBLIC_KEY');
  }
  if (config.PUSH_VAPID_PRIVATE_KEY === undefined) {
    missing.push('PUSH_VAPID_PRIVATE_KEY');
  }
  if (config.PUSH_VAPID_SUBJECT === undefined) {
    missing.push('PUSH_VAPID_SUBJECT');
  }
  if (config.PUSH_COMPONENT_JID === undefined) {
    missing.push('PUSH_COMPONENT_JID');
  }
  if (config.PUSH_COMPONENT_SECRET === undefined) {
    missing.push('PUSH_COMPONENT_SECRET');
  }
  if (config.PUSH_STORAGE_KEY === undefined) {
    missing.push('PUSH_STORAGE_KEY');
  }
  return missing.length === 0 ? null : `push is enabled but missing: ${missing.join(', ')}`;
}
