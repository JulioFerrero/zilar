// The AI routes' logger is a small `{ warn }` shape, but the shared error
// envelope logs defects with `error`. Both read the same `(fields, message)`
// pair, so adapt one to the other without touching the service's shape.

import type { Logger } from 'pino';
import type { AiLogger } from './service';

export function toLogger(logger: AiLogger): Logger {
  return {
    error: (fields: Record<string, unknown>, message: string) => {
      logger.warn(fields, message);
    },
  } as unknown as Logger;
}
