import { describe, expect, it } from 'vitest';

import { draftEntryKey } from './types';

const TURN = '3f1a2b3c-4d5e-6f70-8a9b-0c1d2e3f4a5b';

describe('draftEntryKey', () => {
  it('keeps a plain message on its own id', () => {
    expect(draftEntryKey('message-1', {})).toBe('message-1');
  });

  it('keeps the draft key for the message that finished the draft', () => {
    expect(draftEntryKey('message-1', { 'message-1': TURN })).toBe(`draft-${TURN}`);
  });

  it('is stable across the draft-to-message swap', () => {
    // The synthetic draft is keyed `draft-<turnId>`; the final message keeps the
    // same key, so React reuses the bubble and its reveal instead of remounting.
    const draftKey = draftEntryKey(`draft-${TURN}`, {});
    const finalKey = draftEntryKey('message-1', { 'message-1': TURN });
    expect(finalKey).toBe(draftKey);
  });
});
