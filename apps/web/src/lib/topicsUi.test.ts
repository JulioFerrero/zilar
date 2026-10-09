import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  readArchivedOpen,
  readCollapsedGroups,
  toggleArchivedOpen,
  toggleCollapsedGroup,
} from './topicsUi';

const COLLAPSED_KEY = 'zilar:collapsedGroups';
const ARCHIVED_KEY = 'zilar:archivedOpen';

describe('topicsUi', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    window.localStorage.clear();
  });

  it('reads an empty set when nothing is stored', () => {
    expect(readCollapsedGroups().size).toBe(0);
    expect(readArchivedOpen().size).toBe(0);
  });

  it('toggles a collapsed group and persists the set', () => {
    const first = toggleCollapsedGroup(new Set(), 'g-1');
    expect([...first]).toEqual(['g-1']);
    expect(window.localStorage.getItem(COLLAPSED_KEY)).toBe('["g-1"]');
    expect([...readCollapsedGroups()]).toEqual(['g-1']);

    const second = toggleCollapsedGroup(first, 'g-1');
    expect(second.size).toBe(0);
    expect(window.localStorage.getItem(COLLAPSED_KEY)).toBe('[]');
  });

  it('toggles the archived section under its own key', () => {
    const open = toggleArchivedOpen(new Set(), 'g-2');
    expect([...open]).toEqual(['g-2']);
    expect(window.localStorage.getItem(ARCHIVED_KEY)).toBe('["g-2"]');
    expect(readCollapsedGroups().size).toBe(0);
    expect([...readArchivedOpen()]).toEqual(['g-2']);
  });

  it('keeps only string entries from a stored array', () => {
    window.localStorage.setItem(COLLAPSED_KEY, JSON.stringify(['g-1', 7, null, 'g-2']));
    expect([...readCollapsedGroups()]).toEqual(['g-1', 'g-2']);
  });

  it('reads a corrupt or non-array value as empty and never throws', () => {
    window.localStorage.setItem(COLLAPSED_KEY, '{not json');
    expect(readCollapsedGroups().size).toBe(0);

    window.localStorage.setItem(COLLAPSED_KEY, JSON.stringify({ g: 1 }));
    expect(readCollapsedGroups().size).toBe(0);
  });

  it('falls back to empty reads and still returns the toggled set when storage is blocked', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('full');
    });

    expect(readCollapsedGroups().size).toBe(0);
    const next = toggleCollapsedGroup(new Set(), 'g-3');
    expect([...next]).toEqual(['g-3']);
  });
});
