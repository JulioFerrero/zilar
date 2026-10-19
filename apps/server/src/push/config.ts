import { Effect, Exit, Schema, SchemaGetter, SchemaIssue } from 'effect';
import { booleanFlagSchema } from '../config/load';

// Push configuration. Everything is optional so the server boots without
// push: routes answer 404 and the component stays off unless
// `PUSH_ENABLED=true`; when enabled the VAPID keys, component credentials
// and storage key must all be present.

const toInt = SchemaGetter.transform((value: string) => Number.parseInt(value, 10));
const toText = SchemaGetter.transform((value: number) => String(value));

function withDefault<S extends Schema.Constraint>(schema: S, fallback: S['Encoded']) {
  return Schema.withDecodingDefaultKey<S>(Effect.succeed(fallback))(schema);
}

const nonEmptyStringSchema = Schema.String.pipe(Schema.check(Schema.isMinLength(1)));

// The documented public placeholder: agreeing on it would authenticate with
// a known secret, so it counts as missing and push stays off (SEC-5).
const PLACEHOLDER_PUSH_COMPONENT_SECRET = 'CHANGE_ME_PUSH_COMPONENT_SECRET';

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
  // Host of ejabberd's XEP-0114 listener: compose sets `ejabberd`, dev keeps
  // 127.0.0.1. A scheme, port or path would build a broken URL, so only
  // letters, digits, dots and hyphens pass; the value is never echoed.
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
  // Seals Web Push keys at rest (AES-256-GCM), at least 32 characters.
  // Rotating it orphans rows: the component drops undecryptable devices and
  // the list invites re-enabling.
  PUSH_STORAGE_KEY: Schema.optional(Schema.String.pipe(Schema.check(Schema.isMinLength(32)))),
  // FCM HTTP v1 service account (the JSON as a one-line secret);
  // `FCM_PROJECT_ID` may come from its `project_id`. Optional: without either
  // the server boots as before.
  FCM_SERVICE_ACCOUNT_JSON: Schema.optional(nonEmptyStringSchema),
  FCM_PROJECT_ID: Schema.optional(nonEmptyStringSchema),
});

export type PushConfig = Schema.Schema.Type<typeof pushEnvSchema>;

class PushConfigError extends Error {
  readonly failedKeys: ReadonlyArray<string>;

  constructor(failedKeys: ReadonlyArray<string>) {
    super('Invalid push configuration');
    this.name = 'PushConfigError';
    this.failedKeys = failedKeys;
  }
}

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

function emptyPushSettingsAsUnset(
  env: Record<string, string | undefined>,
): Record<string, string | undefined> {
  const normalized = { ...env };
  for (const key of Object.keys(normalized)) {
    if ((key.startsWith('PUSH_') || key.startsWith('FCM_')) && normalized[key] === '') {
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

const fcmServiceAccountSchema = Schema.Struct({
  client_email: nonEmptyStringSchema,
  private_key: nonEmptyStringSchema,
  project_id: Schema.optional(nonEmptyStringSchema),
});

export type FcmServiceAccount = {
  clientEmail: string;
  privateKey: string;
};

export type FcmConfig = {
  serviceAccount: FcmServiceAccount;
  projectId: string;
};

function parseFcmServiceAccount(
  raw: string,
): { serviceAccount: FcmServiceAccount; projectId: string | null } | null {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return null;
  }
  const exit = Schema.decodeUnknownExit(fcmServiceAccountSchema)(json);
  if (!Exit.isSuccess(exit)) {
    return null;
  }
  return {
    serviceAccount: { clientEmail: exit.value.client_email, privateKey: exit.value.private_key },
    projectId: exit.value.project_id ?? null,
  };
}

export function readFcmConfig(config: PushConfig): FcmConfig | null {
  const raw = config.FCM_SERVICE_ACCOUNT_JSON;
  if (raw === undefined) {
    return null;
  }
  const parsed = parseFcmServiceAccount(raw);
  if (parsed === null) {
    return null;
  }
  const projectId = config.FCM_PROJECT_ID ?? parsed.projectId;
  if (projectId === null) {
    return null;
  }
  return { serviceAccount: parsed.serviceAccount, projectId };
}

export function pushConfigError(config: PushConfig): string | null {
  if (config.FCM_SERVICE_ACCOUNT_JSON !== undefined) {
    const parsed = parseFcmServiceAccount(config.FCM_SERVICE_ACCOUNT_JSON);
    if (parsed === null) {
      return 'push is misconfigured: FCM_SERVICE_ACCOUNT_JSON';
    }
    if ((config.FCM_PROJECT_ID ?? parsed.projectId) === null) {
      return 'push is misconfigured: FCM_PROJECT_ID';
    }
  }
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
  if (
    config.PUSH_COMPONENT_SECRET === undefined ||
    config.PUSH_COMPONENT_SECRET === PLACEHOLDER_PUSH_COMPONENT_SECRET
  ) {
    missing.push('PUSH_COMPONENT_SECRET');
  }
  if (config.PUSH_STORAGE_KEY === undefined) {
    missing.push('PUSH_STORAGE_KEY');
  }
  return missing.length === 0 ? null : `push is enabled but missing: ${missing.join(', ')}`;
}
