const COLLAPSED_KEY = 'galena:collapsedGroups';
const ARCHIVED_KEY = 'galena:archivedOpen';

function readSet(storage: Storage | undefined, key: string): Set<string> {
  const result = new Set<string>();
  if (storage === undefined) {
    return result;
  }
  try {
    const raw = storage.getItem(key);
    if (raw === null) {
      return result;
    }
    const parsed: unknown = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      for (const entry of parsed) {
        if (typeof entry === 'string') {
          result.add(entry);
        }
      }
    }
  } catch {
    // A corrupt or blocked storage must never break the list.
  }
  return result;
}

function writeSet(storage: Storage | undefined, key: string, value: Set<string>): void {
  if (storage === undefined) {
    return;
  }
  try {
    storage.setItem(key, JSON.stringify([...value]));
  } catch {
    // Ignore a full or blocked storage.
  }
}

function storage(): Storage | undefined {
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
}

/** The group ids whose sidebar section is collapsed (persisted). */
export function readCollapsedGroups(): Set<string> {
  return readSet(storage(), COLLAPSED_KEY);
}

/** Toggles one group's collapse and persists it. Returns the new set. */
export function toggleCollapsedGroup(current: Set<string>, groupId: string): Set<string> {
  const next = new Set(current);
  if (next.has(groupId)) {
    next.delete(groupId);
  } else {
    next.add(groupId);
  }
  writeSet(storage(), COLLAPSED_KEY, next);
  return next;
}

/** The `${groupId}` keys whose "Archived" toggle is open (persisted). */
export function readArchivedOpen(): Set<string> {
  return readSet(storage(), ARCHIVED_KEY);
}

/** Toggles one group's "Archived" section and persists it. */
export function toggleArchivedOpen(current: Set<string>, groupId: string): Set<string> {
  const next = new Set(current);
  if (next.has(groupId)) {
    next.delete(groupId);
  } else {
    next.add(groupId);
  }
  writeSet(storage(), ARCHIVED_KEY, next);
  return next;
}
