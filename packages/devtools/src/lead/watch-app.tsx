// `lead watch` as an Ink terminal app: `WatchApp` is pure (view in, lines out) so
// tests render it with `ink-testing-library`; `WatchLive` owns the refresh, clock and
// quit keys.

export { WatchLive } from './watch-app/live.js';
export type { WatchAppProps } from './watch-app/view.js';
export { WatchApp } from './watch-app/view.js';
export { Footer, Header, TaskCard } from './watch-app/chrome.js';
export { badgeSegs, FilesLine, ModelBadge, speedSegs, StepTracker } from './watch-app/lines.js';
