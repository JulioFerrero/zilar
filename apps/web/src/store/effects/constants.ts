// Timing and size constants of the web chat store. The shared ones live in
// `@zilar/client-core/store` (T-0915); the web-only ones stay here. `realStore.ts`
// re-exports the ones its callers and tests import.
export { LAST_READ_PREFIX, TYPING_CLEAR_MS } from '@zilar/client-core/store';
export const PREVIEW_HISTORY_MAX = 1;
export const PAGE_HISTORY_MAX = 50;
export const CHAT_REFRESH_DEBOUNCE_MS = 500;
// Waits between XMPP connect attempts after a failed token or login.
export { CONNECT_RETRY_DELAYS_MS } from '@zilar/client-core/store';
// A send that neither succeeds nor fails within this long is marked failed
// with the reason `timed_out`, so a hung request cannot sit on the clock.
export const SEND_TIMEOUT_MS = 60_000;
// The chat list poll, the open chat's pins poll (T-0114) and the draft timers
// are shared with mobile; they live in `@zilar/client-core/store`.
export {
  DRAFT_END_FALLBACK_MS,
  DRAFT_IDLE_MS,
  PINS_REFRESH_INTERVAL_MS,
  TOPIC_REFRESH_INTERVAL_MS,
} from '@zilar/client-core/store';
export { FINISHED_TURNS_MAX } from '@zilar/client-core/store';
