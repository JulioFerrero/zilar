import { pino, type DestinationStream, type Logger, type LoggerOptions } from 'pino';
import type { ServerConfig } from './config';

const SENSITIVE_KEYS = [
  'password',
  'token',
  'secret',
  'apiKey',
  'api_key',
  'botToken',
  'resendApiKey',
  'private_key',
  'privateKey',
];

// Environment names whose values are secrets (T-1179, OPS-17). Redacted at
// the top level and one level deep, like the generic keys above, so a logged
// config object or error detail can never carry them.
const SENSITIVE_ENV_KEYS = [
  'DATABASE_URL',
  'BETTER_AUTH_SECRET',
  'ZILAR_KEY_ENCRYPTION_KEY',
  'GIF_API_KEY',
  'TELEGRAM_BOT_TOKEN',
  'SMTP_PASSWORD',
  'SMTP_USER',
  'LITELLM_MASTER_KEY',
  'GITHUB_APP_PRIVATE_KEY',
  'XMPP_ARCHIVE_DATABASE_URL',
  'FCM_SERVICE_ACCOUNT_JSON',
  'PUSH_VAPID_PRIVATE_KEY',
  'PUSH_STORAGE_KEY',
  'PUSH_COMPONENT_SECRET',
  'ZILAR_XMPP_JWT_SECRET',
  'EJABBERD_ADMIN_PASSWORD',
];

export const redactPaths: string[] = [
  ...SENSITIVE_KEYS,
  ...SENSITIVE_KEYS.map((key) => `*.${key}`),
  ...SENSITIVE_ENV_KEYS,
  ...SENSITIVE_ENV_KEYS.map((key) => `*.${key}`),
  'req.headers.authorization',
  'req.headers.cookie',
];

export function createLogger(config: ServerConfig, destination?: DestinationStream): Logger {
  const options: LoggerOptions = {
    level: config.LOG_LEVEL,
    redact: { paths: redactPaths, censor: '[redacted]' },
  };

  if (destination) {
    return pino(options, destination);
  }

  if (config.NODE_ENV === 'development') {
    return pino({ ...options, transport: { target: 'pino-pretty' } });
  }

  return pino(options);
}
