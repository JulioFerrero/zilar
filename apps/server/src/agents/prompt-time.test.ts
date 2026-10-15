// The prompt's local date and time line (T-1440).
import { describe, expect, it } from 'vitest';
import { promptNow } from './prompt-time';

describe('promptNow', () => {
  const at = new Date('2026-10-15T02:12:00.000Z');

  it('renders the instant in the given zone', () => {
    expect(promptNow(at, 'Europe/Madrid')).toBe('Thursday, 15 October 2026, 04:12 (Europe/Madrid)');
  });

  it('falls back to UTC when the zone is null', () => {
    expect(promptNow(at, null)).toBe('Thursday, 15 October 2026, 02:12 (UTC)');
  });
});
