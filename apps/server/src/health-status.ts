// A module-level registry (one process) of the push component's liveness,
// its last send outcome, and the two leader-drain flags the `/health` builder
// reads. `component.ts` and `delivery.ts` write the push state; the leader lock
// and the shutdown path write the leader/draining flags.
//
// It holds no secrets: the snapshot only ever carries a status, an ISO
// timestamp, a failure kind and two booleans.

export type PushStatus = 'online' | 'offline' | 'unknown';

export type PushFailureKind = 'send-failed' | 'archive-unavailable';

export type HealthSnapshot = {
  push: PushStatus;
  /** True while this instance holds the leader advisory lock (T-1316). */
  leader: boolean;
  /** True from SIGTERM until the process closes (T-1316). */
  draining: boolean;
  lastPushSentAt?: string;
  lastPushFailure?: { at: string; kind: PushFailureKind };
};

type PushState = {
  status: PushStatus;
  // Why the component went offline is kept for diagnostics only and is
  // deliberately not part of `healthSnapshot()`: the public `/health` route
  // serialises that snapshot, and it must never leak internal error text.
  offlineReason?: string;
  lastPushSentAt?: string;
  lastPushFailure?: { at: string; kind: PushFailureKind };
};

let state: PushState = { status: 'unknown' };

// Leader/drain state, set by `leader/lock.ts` and `main.ts`'s shutdown path.
let leader = false;
let draining = false;

// The leader lock calls this when it acquires (true) and steps down (false).
export function markLeader(value: boolean): void {
  leader = value;
}

// Called once, at the start of shutdown, so `/health` answers 503 while the
// process is still serving during the drain.
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
