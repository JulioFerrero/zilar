import { describe, expect, it } from 'vitest';

import { guardDecision, safeTarget } from './guard';

describe('guardDecision', () => {
  it('waits while the session loads', () => {
    expect(guardDecision({ status: 'loading', name: undefined, target: '/chat/ana' })).toEqual({
      kind: 'loading',
    });
  });

  it('sends a guest to login and preserves the target', () => {
    expect(guardDecision({ status: 'guest', name: undefined, target: '/chat/ana' })).toEqual({
      kind: 'login',
      from: '/chat/ana',
    });
  });

  it('sends a user without a name to the name step', () => {
    expect(guardDecision({ status: 'authenticated', name: '', target: '/' })).toEqual({
      kind: 'name',
    });
    expect(guardDecision({ status: 'authenticated', name: '   ', target: '/' })).toEqual({
      kind: 'name',
    });
  });

  it('allows a named user through', () => {
    expect(guardDecision({ status: 'authenticated', name: 'Ada', target: '/' })).toEqual({
      kind: 'allow',
    });
  });

  it('keeps an offline session in the app instead of sending it to login', () => {
    expect(guardDecision({ status: 'offline', name: 'Ada', target: '/chat/ana' })).toEqual({
      kind: 'allow',
    });
    expect(guardDecision({ status: 'offline', name: undefined, target: '/chat/ana' })).toEqual({
      kind: 'loading',
    });
  });
});

describe('safeTarget', () => {
  it('keeps relative in-app paths', () => {
    expect(safeTarget('/chat/ana')).toBe('/chat/ana');
    expect(safeTarget(['/chat/ana'])).toBe('/chat/ana');
  });

  it('falls back to the root for missing or external targets', () => {
    expect(safeTarget(undefined)).toBe('/');
    expect(safeTarget('https://evil.example')).toBe('/');
    expect(safeTarget('')).toBe('/');
  });
});
