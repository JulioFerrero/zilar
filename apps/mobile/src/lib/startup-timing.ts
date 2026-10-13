// Cold-start timing marks (T-1312), recorded in dev builds only. Metro defines
// the `__DEV__` global and folds these branches to `false` in a release build,
// so nothing is recorded or logged in production.
//
// `__DEV__` does not exist under Vitest, so it is read through `typeof`; a
// module that only imports this one never throws in a test.

export type StartupMark = 'app-start' | 'fonts-ready' | 'session' | 'chat-list' | 'xmpp-online';

const DEV = typeof __DEV__ !== 'undefined' && __DEV__;

const marks = new Map<StartupMark, number>();

/** Milliseconds within the JS runtime; wall time where `performance` is absent. */
function now(): number {
  return typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now();
}

/** Whether the dev-only marks are recorded; real store wiring guards on it. */
export function startupTimingEnabled(): boolean {
  return DEV;
}

if (DEV) {
  marks.set('app-start', now());
}

/**
 * Records the first time a cold-start milestone is reached and logs the elapsed
 * time since `app-start`, so one development cold start shows where the time
 * before the chat list goes.
 */
export function markStartup(mark: StartupMark): void {
  if (!DEV || marks.has(mark)) {
    return;
  }
  const at = now();
  marks.set(mark, at);
  const base = marks.get('app-start') ?? at;
  console.log(`[startup] ${mark} +${Math.round(at - base)}ms`);
}
