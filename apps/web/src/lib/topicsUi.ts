import { Effect, Schema } from 'effect';

const COLLAPSED_KEY = 'zilar:collapsedGroups';
const ARCHIVED_KEY = 'zilar:archivedOpen';

// The stored value is a JSON array; anything else reads as empty.
const decodeStoredList = Schema.decodeUnknownSync(
  Schema.fromJsonString(Schema.Array(Schema.Unknown)),
);

/**
 * Runs one localStorage step at this sync edge. A blocked or missing storage
 * gives `fallback`, so the list keeps working without it.
 */
function storageStep<A>(fallback: A, step: (storage: Storage) => A): A {
  return Effect.runSync(
    Effect.try(() => step(window.localStorage)).pipe(Effect.orElseSucceed(() => fallback)),
  );
}

function readSet(key: string): Set<string> {
  const raw = storageStep<string | null>(null, (storage) => storage.getItem(key));
  // A corrupt or blocked storage must never break the list.
  const entries =
    raw === null
      ? []
      : Effect.runSync(
          Effect.try(() => decodeStoredList(raw)).pipe(Effect.orElseSucceed(() => [])),
        );
  return new Set(entries.filter((entry): entry is string => typeof entry === 'string'));
}

function writeSet(key: string, value: Set<string>): void {
  // Ignore a full or blocked storage.
  storageStep<void>(undefined, (storage) => {
    storage.setItem(key, JSON.stringify([...value]));
  });
}

/** The group ids whose sidebar section is collapsed (persisted). */
export function readCollapsedGroups(): Set<string> {
  return readSet(COLLAPSED_KEY);
}

/** Toggles one group's collapse and persists it. Returns the new set. */
export function toggleCollapsedGroup(current: Set<string>, groupId: string): Set<string> {
  const next = new Set(current);
  if (next.has(groupId)) {
    next.delete(groupId);
  } else {
    next.add(groupId);
  }
  writeSet(COLLAPSED_KEY, next);
  return next;
}

/** The `${groupId}` keys whose "Archived" toggle is open (persisted). */
export function readArchivedOpen(): Set<string> {
  return readSet(ARCHIVED_KEY);
}

/** Toggles one group's "Archived" section and persists it. */
export function toggleArchivedOpen(current: Set<string>, groupId: string): Set<string> {
  const next = new Set(current);
  if (next.has(groupId)) {
    next.delete(groupId);
  } else {
    next.add(groupId);
  }
  writeSet(ARCHIVED_KEY, next);
  return next;
}
