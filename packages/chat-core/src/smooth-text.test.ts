import { describe, expect, it } from 'vitest';

import {
  type ActiveSource,
  commonPrefixLength,
  type FrameScheduler,
  safeCut,
  SmoothTextReveal,
} from './smooth-text';

/** A frame scheduler the test advances by hand, so no real clock is involved. */
function manualFrames(): {
  frames: FrameScheduler;
  run: (time: number) => void;
} {
  let nextHandle = 1;
  const pending = new Map<number, (time: number) => void>();
  const frames: FrameScheduler = {
    request: (callback) => {
      const handle = nextHandle;
      nextHandle += 1;
      pending.set(handle, callback);
      return handle;
    },
    cancel: (handle) => {
      pending.delete(handle);
    },
  };
  return {
    frames,
    run: (time) => {
      const callbacks = [...pending.values()];
      pending.clear();
      for (const callback of callbacks) {
        callback(time);
      }
    },
  };
}

/** A foreground source the test toggles, like a tab becoming visible. */
function manualActive(): { active: ActiveSource; toActive: () => void } {
  const listeners = new Set<() => void>();
  return {
    active: {
      subscribe: (onActive) => {
        listeners.add(onActive);
        return () => listeners.delete(onActive);
      },
    },
    toActive: () => {
      for (const listener of listeners) {
        listener();
      }
    },
  };
}

describe('commonPrefixLength', () => {
  it('measures the shared start of two strings', () => {
    expect(commonPrefixLength('abcdef', 'abcxyz')).toBe(3);
    expect(commonPrefixLength('same', 'same')).toBe(4);
    expect(commonPrefixLength('', 'anything')).toBe(0);
  });
});

describe('safeCut', () => {
  it('keeps a surrogate pair together', () => {
    const text = 'a😀b';
    expect(safeCut(text, 2)).toBe(3);
    expect(safeCut(text, 1)).toBe(1);
  });
});

describe('SmoothTextReveal', () => {
  it('resumes at the common prefix when the target restarts', () => {
    const { frames, run } = manualFrames();
    const reveal = new SmoothTextReveal('The answer is 4', { frames, initial: 'full' });

    reveal.setTarget('The result is 42');

    expect(reveal.text).toBe('The ');
    expect(reveal.done).toBe(false);

    run(0);
    run(100);
    run(200);

    expect(reveal.text).toBe('The result is 42');
    expect(reveal.done).toBe(true);
  });

  it('snaps to the full text when the page or app becomes active', () => {
    const { frames } = manualFrames();
    const { active, toActive } = manualActive();
    const reveal = new SmoothTextReveal('', { frames, active });

    reveal.setTarget('A reply arrived while the tab was hidden');
    expect(reveal.text).toBe('');
    expect(reveal.done).toBe(false);

    toActive();

    expect(reveal.text).toBe('A reply arrived while the tab was hidden');
    expect(reveal.done).toBe(true);
  });

  it('shows the text at once with reduced motion', () => {
    const { frames } = manualFrames();
    const reveal = new SmoothTextReveal('Full reply', { frames, reducedMotion: true });

    expect(reveal.text).toBe('Full reply');
    expect(reveal.done).toBe(true);

    reveal.setTarget('Rewritten reply');
    expect(reveal.text).toBe('Rewritten reply');
  });

  it('reveals growth frame by frame and stops at the target', () => {
    const { frames, run } = manualFrames();
    const reveal = new SmoothTextReveal('', { frames });

    reveal.setTarget('Hello');
    expect(reveal.text).toBe('');
    run(0);
    run(100);
    expect(reveal.text).toBe('Hello');

    reveal.setTarget('Hello world');
    run(200);
    run(300);
    expect(reveal.text).toBe('Hello world');
  });
});
