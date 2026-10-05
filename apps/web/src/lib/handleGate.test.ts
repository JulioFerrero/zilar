import { beforeEach, describe, expect, it } from 'vitest';
import { dismissHandleGate, hasDismissedHandleGate, resetHandleGateDismissal } from './handleGate';

describe('handleGate dismissal', () => {
  beforeEach(() => {
    resetHandleGateDismissal();
    window.sessionStorage.clear();
  });

  it('is not dismissed by default', () => {
    expect(hasDismissedHandleGate('u-1')).toBe(false);
  });

  it('records the dismissal per user id', () => {
    dismissHandleGate('u-1');
    expect(hasDismissedHandleGate('u-1')).toBe(true);
    expect(hasDismissedHandleGate('u-2')).toBe(false);
  });

  it('a new sign-in session for another user asks again', () => {
    dismissHandleGate('u-1');
    expect(hasDismissedHandleGate('u-2')).toBe(false);
  });

  it('survives in sessionStorage across reads', () => {
    dismissHandleGate('u-1');
    expect(window.sessionStorage.getItem('zilar:handleGateDismissed:u-1')).toBe('1');
    expect(hasDismissedHandleGate('u-1')).toBe(true);
  });

  it('falls back to memory when storage throws', () => {
    const setItem = window.sessionStorage.setItem.bind(window.sessionStorage);
    window.sessionStorage.setItem = () => {
      throw new Error('blocked');
    };
    try {
      dismissHandleGate('u-9');
      expect(hasDismissedHandleGate('u-9')).toBe(true);
    } finally {
      window.sessionStorage.setItem = setItem;
    }
  });

  it('resets per user or entirely (new sign-in session asks again)', () => {
    dismissHandleGate('u-1');
    dismissHandleGate('u-2');
    resetHandleGateDismissal('u-1');
    // Per-user reset clears both the in-memory flag and the sessionStorage
    // entry for that user; the other user is untouched.
    expect(hasDismissedHandleGate('u-1')).toBe(false);
    expect(window.sessionStorage.getItem('zilar:handleGateDismissed:u-1')).toBeNull();
    expect(hasDismissedHandleGate('u-2')).toBe(true);
    resetHandleGateDismissal();
    // Full reset clears the in-memory set, but other tabs' sessionStorage
    // entries are namespaced per test run — clear them here for isolation.
    window.sessionStorage.clear();
    expect(hasDismissedHandleGate('u-2')).toBe(false);
  });
});
