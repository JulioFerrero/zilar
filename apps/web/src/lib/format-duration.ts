// T-1562: the `m:ss` format moved to `@zilar/chat-core` so web and the phone
// share one implementation; this re-export keeps every web importer unchanged.
export { formatClock } from '@zilar/chat-core';
