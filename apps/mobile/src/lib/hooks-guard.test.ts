import { describe, expect, it } from 'vitest';

import { hooksAfterMarker } from './hooks-guard';

const BEFORE = `function Chat() {
  const chat = null as unknown;
  useEffect(() => {}, []);
  if (!chat) {
    return null;
  }
  useEffect(() => {}, []);
}`;

const AFTER = `function Chat() {
  const chat = null as unknown;
  useEffect(() => {}, []);
  const redirect = chat === null ? undefined : 'g1';
  useEffect(() => {}, [redirect]);
  if (!chat) {
    return null;
  }
}`;

describe('hooksAfterMarker', () => {
  it('finds a hook after the early return (the pre-fix shape)', () => {
    expect(hooksAfterMarker(BEFORE, 'if (!chat) {')).toEqual(['useEffect(']);
  });

  it('passes for the fixed shape with every hook above the return', () => {
    expect(hooksAfterMarker(AFTER, 'if (!chat) {')).toEqual([]);
  });

  it('reports a missing marker instead of passing silently', () => {
    expect(hooksAfterMarker(AFTER, 'if (!nope) {')).toHaveLength(1);
  });
});
