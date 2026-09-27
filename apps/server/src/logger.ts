import { pino, type DestinationStream, type Logger, type LoggerOptions } from 'pino';
import type { ServerConfig } from './config';

const SENSITIVE_KEYS = ['password', 'token', 'secret', 'apiKey', 'api_key'];

export const redactPaths: string[] = [
  ...SENSITIVE_KEYS,
  ...SENSITIVE_KEYS.map((key) => `*.${key}`),
  'req.headers.authorization',
  'req.headers.cookie',
  'DATABASE_URL',
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
