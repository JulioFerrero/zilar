// Loading and finalizing the server config (T-1457), split out of `config.ts`:
// the schema-error walker, the empty-string normalization, the derived fields
// and the public `ServerConfig` service + loaders. The barrel `config.ts`
// re-exports the names other modules import.

import { Context, Exit, Layer, Schema, SchemaIssue } from 'effect';
import { loadXmppConfig, type XmppConfig } from '../xmpp/config';
import { crossFieldDetails, type ConfigDetail } from './mail';
import { serverConfigSchema, type RawServerConfig } from './server-schema';

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigError';
  }
}

// Maps Effect's issue tree to the same `path (reason)` pairs zod produced:
// `missing` for an absent required key, the custom message for a filter that
// returned one, and `invalid` otherwise. Only names and code-written messages
// are used, never a value.
function collectDetails(
  issue: SchemaIssue.Issue,
  path: ReadonlyArray<PropertyKey> = [],
): ReadonlyArray<ConfigDetail> {
  switch (issue._tag) {
    case 'Composite':
      return issue.issues.flatMap((child) => collectDetails(child, path));
    case 'Pointer':
      return collectDetails(issue.issue, [...path, ...issue.path]);
    case 'MissingKey':
      return [{ name: path.join('.'), reason: 'missing' }];
    case 'InvalidType':
      return [{ name: path.join('.'), reason: issue.input === undefined ? 'missing' : 'invalid' }];
    case 'InvalidValue': {
      const message = issue.annotations?.message;
      return [
        {
          name: path.join('.'),
          reason: typeof message === 'string' && message.length > 0 ? message : 'invalid',
        },
      ];
    }
    case 'Filter':
    case 'Encoding':
      return collectDetails(issue.issue, path);
    default:
      return [{ name: path.join('.'), reason: 'invalid' }];
  }
}

function formatIssues(details: ReadonlyArray<ConfigDetail>): string {
  const seen = new Set<string>();
  const parts: string[] = [];
  for (const { name, reason } of details) {
    // One entry per issue so several precise messages survive under one
    // path (for example both SMTP rules); exact duplicates collapse.
    const detail = `${name || 'env'} (${reason})`;
    if (!seen.has(detail)) {
      seen.add(detail);
      parts.push(detail);
    }
  }
  return `Invalid server configuration: ${parts.join(', ')}`;
}

// Docker Compose renders an unset optional as an empty string (`${VAR:-}`),
// which a bare optional would reject. For the optional mail settings and the
// optional key-encryption key an empty value means "not set". Explicit
// `undefined` values are dropped too, so a key-based schema default applies to
// them exactly as zod's `?? default` did.
const EMPTY_MEANS_UNSET_KEYS = [
  'ZILAR_KEY_ENCRYPTION_KEY',
  'MAIL_TRANSPORT',
  'SMTP_HOST',
  'SMTP_USER',
  'SMTP_PASSWORD',
  'MAIL_FROM',
  'MAIL_REPLY_TO',
  'DESK_AGENT_SOCKET',
  'DESK_IMAGE',
] as const;

function emptyMailSettingsAsUnset(
  env: Record<string, string | undefined>,
): Record<string, string | undefined> {
  const normalized: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(env)) {
    if (value !== undefined) {
      normalized[key] = value;
    }
  }
  for (const key of EMPTY_MEANS_UNSET_KEYS) {
    if (normalized[key] === '') {
      delete normalized[key];
    }
  }
  return normalized;
}

// Derives `MAIL_TRANSPORT`, `BETTER_AUTH_URL` and `AGENT_TOOL_MAX_ROUNDS`
// after a successful decode, exactly like the zod object transform did, then
// attaches the XMPP config. The returned object's type is the public
// `ServerConfig`.
function finalizeConfig(raw: RawServerConfig, xmpp: XmppConfig) {
  return {
    ...raw,
    WEB_ORIGINS: [...new Set(raw.WEB_ORIGINS.map((origin) => new URL(origin).origin))],
    MAIL_TRANSPORT: raw.MAIL_TRANSPORT ?? (raw.NODE_ENV === 'production' ? undefined : 'console'),
    BETTER_AUTH_URL: raw.BETTER_AUTH_URL ?? raw.PUBLIC_URL,
    // Unset = 1 when tools are off (today's behaviour), 6 when on.
    AGENT_TOOL_MAX_ROUNDS:
      raw.AGENT_TOOL_MAX_ROUNDS === ''
        ? raw.TOOLS_ENABLED
          ? 6
          : 1
        : Number.parseInt(raw.AGENT_TOOL_MAX_ROUNDS, 10),
    xmpp,
  };
}

export type ServerConfig = ReturnType<typeof finalizeConfig>;

// The Effect `Context` tag other services ask for; `ServerConfigLive` builds
// it from `process.env` at provision time (not at import time, so importing
// this module never parses the environment).
export const ServerConfig = Context.Service<ServerConfig>('ServerConfig');

export const ServerConfigLive: Layer.Layer<ServerConfig> = Layer.sync(ServerConfig, () =>
  loadServerConfig(process.env),
);

export function loadServerConfig(rawEnv: Record<string, string | undefined>): ServerConfig {
  const env = emptyMailSettingsAsUnset(rawEnv);
  const exit = Schema.decodeUnknownExit(serverConfigSchema, { errors: 'all' })(env);

  if (Exit.isSuccess(exit)) {
    const details = crossFieldDetails(env);
    if (details.length > 0) {
      throw new ConfigError(formatIssues(details));
    }

    let xmpp: XmppConfig;
    try {
      xmpp = loadXmppConfig(env);
    } catch (error) {
      if (error instanceof Error) {
        throw new ConfigError(error.message);
      }
      throw error;
    }

    return finalizeConfig(exit.value, xmpp);
  }

  const details: ConfigDetail[] = [];
  for (const reason of exit.cause.reasons) {
    if (reason._tag === 'Fail') {
      details.push(...collectDetails(reason.error.issue));
    }
  }
  const defect = exit.cause.reasons.find((reason) => reason._tag === 'Die');
  if (details.length === 0 && defect !== undefined && defect._tag === 'Die') {
    throw defect.defect;
  }
  details.push(...crossFieldDetails(env));
  throw new ConfigError(formatIssues(details));
}

export function loadServerConfigOrExit(env: Record<string, string | undefined>): ServerConfig {
  try {
    return loadServerConfig(env);
  } catch (error) {
    if (error instanceof ConfigError) {
      console.error(error.message);
      process.exit(1);
    }
    throw error;
  }
}
