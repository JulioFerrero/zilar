// Timing and size constants of the web chat store. `realStore.ts` re-exports
// the ones its callers and tests import.
export const LAST_READ_PREFIX = 'zilar:lastRead:';
export const PREVIEW_HISTORY_MAX = 1;
export const PAGE_HISTORY_MAX = 50;
export const TYPING_CLEAR_MS = 5000;
export const CHAT_REFRESH_DEBOUNCE_MS = 500;
// Refetch `/api/chats` every 60 s while the tab is visible (T-0111), so a
// topic created, made private, or where I was removed appears or disappears
// without a reload.
export const TOPIC_REFRESH_INTERVAL_MS = 60_000;
// Waits between XMPP connect attempts after a failed token or login.
export const CONNECT_RETRY_DELAYS_MS = [2_000, 5_000, 15_000, 30_000, 60_000];
// A send that neither succeeds nor fails within this long is marked failed
// with the reason `timed_out`, so a hung request cannot sit on the clock.
export const SEND_TIMEOUT_MS = 60_000;
// T-0114: the open chat's pins refresh on the same cadence (no realtime channel).
export const PINS_REFRESH_INTERVAL_MS = 60_000;

// A finished draft is kept until its final XMPP message arrives. If that never
// happens (XMPP down), it is dropped after this long so it cannot stick.
export const DRAFT_END_FALLBACK_MS = 5_000;

// A draft that sees no further event for this long is stale (e.g. the server
// restarted mid-turn); the idle timer drops it rather than leaving it forever.
export const DRAFT_IDLE_MS = 60_000;

// Finished turn ids are remembered only to ignore a late `draft`. The set is
// capped so it cannot grow for the life of the tab.
export { FINISHED_TURNS_MAX } from '@zilar/client-core/store';
