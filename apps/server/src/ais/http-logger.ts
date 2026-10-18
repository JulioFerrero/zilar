// The AI logger has `{ warn }`; the shared error envelope logs defects with `error`.

import type { Logger } from 'pino';
import type { AiLogger } from './persona';

export function toLogger(logger: AiLogger): Logger {
  return {
    error: (fields: Record<string, unknown>, message: string) => {
      logger.warn(fields, message);
    },
  } as unknown as Logger;
}
