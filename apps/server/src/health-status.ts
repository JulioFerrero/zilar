// A module-level registry (one process) of the push component's liveness and
// its last send outcome. `component.ts` and `delivery.ts` write to it; the
// `/health` builder reads it through `healthSnapshot()`.
//
// It holds no secrets: the snapshot only ever carries a status, an ISO
// timestamp and a failure kind.

export type PushStatus = 'online' | 'offline' | 'unknown';

export type PushFailureKind = 'send-failed' | 'archive-unavailable';

export type HealthSnapshot = {
  push: PushStatus;
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
    ...(state.lastPushSentAt === undefined ? {} : { lastPushSentAt: state.lastPushSentAt }),
    ...(state.lastPushFailure === undefined ? {} : { lastPushFailure: state.lastPushFailure }),
  };
}
