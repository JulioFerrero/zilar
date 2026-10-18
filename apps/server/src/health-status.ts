// Process-wide push and leader liveness, read by the `/health` builder. It holds no
// secrets: a status, an ISO timestamp, a failure kind and the drain flags.

export type PushStatus = 'online' | 'offline' | 'unknown';

export type PushFailureKind = 'send-failed' | 'archive-unavailable';

export type HealthSnapshot = {
  push: PushStatus;
  leader: boolean;
  /** True from SIGTERM until the process closes. */
  draining: boolean;
  lastPushSentAt?: string;
  lastPushFailure?: { at: string; kind: PushFailureKind };
};

type PushState = {
  status: PushStatus;
  // The failure reason stays out of `healthSnapshot()`: the public `/health` route
  // serialises it, and it must never leak internal error text.
  offlineReason?: string;
  lastPushSentAt?: string;
  lastPushFailure?: { at: string; kind: PushFailureKind };
};

let state: PushState = { status: 'unknown' };

let leader = false;
let draining = false;

export function markLeader(value: boolean): void {
  leader = value;
}

// Called once at shutdown so `/health` answers 503 while the process drains.
export function markDraining(): void {
  draining = true;
}

export function markPushOnline(): void {
  state = { ...state, status: 'online' };
}

export function markPushOffline(reason: string): void {
  state = { ...state, status: 'offline', offlineReason: reason };
}

export function markPushSent(): void {
  state = { ...state, lastPushSentAt: new Date().toISOString() };
}

export function markPushFailed(kind: PushFailureKind): void {
  state = { ...state, lastPushFailure: { at: new Date().toISOString(), kind } };
}

export function healthSnapshot(): HealthSnapshot {
  return {
    push: state.status,
    leader,
    draining,
    ...(state.lastPushSentAt === undefined ? {} : { lastPushSentAt: state.lastPushSentAt }),
    ...(state.lastPushFailure === undefined ? {} : { lastPushFailure: state.lastPushFailure }),
  };
}
