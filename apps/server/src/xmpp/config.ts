import { Effect, Exit, Schema, SchemaIssue } from 'effect';
import { isJid } from '@zilar/protocol';

// Lowercase host name (letters, digits, dots, hyphens). No port, no scheme.
const domainSchema = Schema.String.pipe(
  Schema.check(Schema.isMinLength(1)),
  Schema.check(Schema.isMaxLength(253)),
  Schema.check(
    Schema.makeFilter((value: string) =>
      /^[a-z0-9.-]+$/.test(value) ? undefined : 'must be a lowercase host name',
    ),
  ),
);

function isUrlWithProtocols(...protocols: ReadonlyArray<string>): (value: string) => boolean {
  return (value) => {
    try {
      return protocols.includes(new URL(value).protocol);
    } catch {
      return false;
    }
  };
}

const isHttpUrl = isUrlWithProtocols('http:', 'https:');
const isWebSocketUrl = isUrlWithProtocols('ws:', 'wss:');

function withDefault<S extends Schema.Constraint>(schema: S, fallback: S['Encoded']) {
  return Schema.withDecodingDefaultKey<S>(Effect.succeed(fallback))(schema);
}

// Configuration the XMPP module needs. Env var names are kept as the schema
// keys so error messages can name the variable that is missing or invalid.
export const xmppEnvSchema = Schema.Struct({
  EJABBERD_API_URL: withDefault(
    Schema.String.pipe(Schema.check(Schema.makeFilter(isHttpUrl))),
    'http://127.0.0.1:5280/api',
  ),
  EJABBERD_ADMIN_JID: Schema.String.pipe(
    Schema.check(
      Schema.makeFilter((value: string) =>
        isJid(value) ? undefined : 'must be a bare JID (local@domain)',
      ),
    ),
  ),
  EJABBERD_ADMIN_PASSWORD: Schema.String.pipe(Schema.check(Schema.isMinLength(1))),
  XMPP_DOMAIN: withDefault(domainSchema, 'zilar.localhost'),
  XMPP_MUC_DOMAIN: withDefault(domainSchema, 'rooms.zilar.localhost'),
  XMPP_WS_PUBLIC_URL: withDefault(
    Schema.String.pipe(Schema.check(Schema.makeFilter(isWebSocketUrl))),
    'ws://127.0.0.1:5280/ws',
  ),
  ZILAR_XMPP_JWT_SECRET: Schema.String.pipe(
    Schema.check(
      Schema.makeFilter((value: string) =>
        value.length >= 32 ? undefined : 'must be at least 32 characters',
      ),
    ),
  ),
});

export type XmppEnv = Schema.Schema.Type<typeof xmppEnvSchema>;

export type XmppConfig = {
  apiUrl: string;
  adminJid: string;
  adminPassword: string;
  domain: string;
  mucDomain: string;
  wsPublicUrl: string;
  jwtSecret: string;
};

// Maps Effect's issue tree to one line per invalid variable. Only names and
// code-written messages are used, never a value, so a secret can never leak
// through a configuration error.
function formatIssues(issue: SchemaIssue.Issue, path: ReadonlyArray<PropertyKey> = []): string[] {
  switch (issue._tag) {
    case 'Composite':
      return issue.issues.flatMap((child) => formatIssues(child, path));
    case 'Pointer':
      return formatIssues(issue.issue, [...path, ...issue.path]);
    case 'MissingKey':
      return [`- ${path.join('.') || '(configuration)'}: missing`];
    case 'InvalidValue': {
      const message = issue.annotations?.message;
      const reason = typeof message === 'string' && message.length > 0 ? message : 'invalid';
      return [`- ${path.join('.') || '(configuration)'}: ${reason}`];
    }
    case 'Filter':
    case 'Encoding':
      return formatIssues(issue.issue, path);
    default:
      return [`- ${path.join('.') || '(configuration)'}: invalid`];
  }
}

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, '');
}

export function loadXmppConfig(env: Record<string, string | undefined>): XmppConfig {
  const exit = Schema.decodeUnknownExit(xmppEnvSchema, { errors: 'all' })(env);
  if (Exit.isFailure(exit)) {
    const lines: string[] = [];
    for (const reason of exit.cause.reasons) {
      if (reason._tag === 'Fail') {
        lines.push(...formatIssues(reason.error.issue));
      }
    }
    const defect = exit.cause.reasons.find((reason) => reason._tag === 'Die');
    if (lines.length === 0 && defect !== undefined && defect._tag === 'Die') {
      throw defect.defect;
    }
    throw new Error(`Invalid XMPP configuration:\n${lines.join('\n')}`);
  }

  const data = exit.value;
  return {
    apiUrl: trimTrailingSlash(data.EJABBERD_API_URL),
    adminJid: data.EJABBERD_ADMIN_JID,
    adminPassword: data.EJABBERD_ADMIN_PASSWORD,
    domain: data.XMPP_DOMAIN,
    mucDomain: data.XMPP_MUC_DOMAIN,
    wsPublicUrl: data.XMPP_WS_PUBLIC_URL,
    jwtSecret: data.ZILAR_XMPP_JWT_SECRET,
  };
}
