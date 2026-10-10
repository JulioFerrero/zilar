// `lead watch` as a proper terminal app, rendered with Ink. `WatchApp` is
// pure (view plus refresh state in, terminal lines out) so tests render it
// with `ink-testing-library`; `WatchLive` owns the 3-second child-process
// refresh, the clock ticker and the quit keys.
//
// Split under `watch-app/` (T-0985). Every importer keeps using
// `./watch-app.js`; this barrel re-exports the same names it always did.

export { WatchLive } from './watch-app/live.js';
export type { WatchAppProps } from './watch-app/view.js';
export { WatchApp } from './watch-app/view.js';
export { Footer, Header, TaskCard } from './watch-app/chrome.js';
export { badgeSegs, FilesLine, ModelBadge, speedSegs, StepTracker } from './watch-app/lines.js';
