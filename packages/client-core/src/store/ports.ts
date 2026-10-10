// The outside world of the chat store core: the clock, whether the user can see
// the app, and the key-value storage. Each app builds these from its own
// adapters (web: `apps/web/src/store/effects/ports.ts`). Later tasks add the
// API, the XMPP factory, the draft stream and the outgoing bytes
// (docs/STORE_CORE_PLAN.md section 4).

/** Synchronous key-value storage (`localStorage` on web), or none. */
export interface KeyValue {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface CorePorts {
  readonly now: () => Date;
  /** True while the user can see the app: the tab is visible, the app is active. */
  readonly isVisible: () => boolean;
  /** Where the last-read map is saved, or null to keep it in memory only. */
  readonly storage: KeyValue | null;
}

/** The ports of a core test: a fixed clock, a visible app, no storage, unless supplied. */
export function testCorePorts(fakes: Partial<CorePorts> = {}): CorePorts {
  return {
    now: fakes.now ?? ((): Date => new Date(0)),
    isVisible: fakes.isVisible ?? ((): boolean => true),
    storage: fakes.storage === undefined ? null : fakes.storage,
  };
}
