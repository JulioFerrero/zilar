// Metro folds `__DEV__` to `false` in a release build, so nothing is recorded or logged in production. `__DEV__` does not exist under Vitest, so it is read through `typeof`.

export type StartupMark = 'app-start' | 'fonts-ready' | 'session' | 'chat-list' | 'xmpp-online';

const DEV = typeof __DEV__ !== 'undefined' && __DEV__;

const marks = new Map<StartupMark, number>();

function now(): number {
  return typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now();
}

export function startupTimingEnabled(): boolean {
  return DEV;
}

if (DEV) {
  marks.set('app-start', now());
}

export function markStartup(mark: StartupMark): void {
  if (!DEV || marks.has(mark)) {
    return;
  }
  const at = now();
  marks.set(mark, at);
  const base = marks.get('app-start') ?? at;
  console.log(`[startup] ${mark} +${Math.round(at - base)}ms`);
}
