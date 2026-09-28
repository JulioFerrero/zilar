import { describe, expect, it } from 'vitest';

import {
  SMOOTH_CATCH_UP_MS,
  SMOOTH_MIN_CHARS_PER_SECOND,
  SmoothTextReveal,
  safeCut,
  type ActiveSource,
  type FrameScheduler,
} from './use-smooth-text';

interface ManualFrames {
  scheduler: FrameScheduler;
  run: (time: number) => void;
  pending: () => number;
}

function manualFrames(): ManualFrames {
  let nextHandle = 1;
  const callbacks = new Map<number, (time: number) => void>();
  return {
    scheduler: {
      request: (callback) => {
        const handle = nextHandle;
        nextHandle += 1;
        callbacks.set(handle, callback);
        return handle;
      },
      cancel: (handle) => {
        callbacks.delete(handle);
      },
    },
    run: (time) => {
      const pending = [...callbacks.values()];
      callbacks.clear();
      for (const callback of pending) {
        callback(time);
      }
    },
    pending: () => callbacks.size,
  };
}

function runToDone(reveal: SmoothTextReveal, frames: ManualFrames, start = 0): number {
  let elapsed = start;
  for (let frame = 0; frame <= 400 && !reveal.done; frame += 1) {
    elapsed = start + frame * 16;
    frames.run(elapsed);
  }
  return elapsed;
}

describe('SmoothTextReveal', () => {
  it('grows monotonically and always stays a prefix of the target', () => {
    const frames = manualFrames();
    const target = 'Hello there, this is a longer reply';
    const reveal = new SmoothTextReveal('', { frames: frames.scheduler, initial: 'zero' });

    reveal.setTarget(target);

    const seen: string[] = [];
    for (let frame = 0; frame <= 200 && !reveal.done; frame += 1) {
      frames.run(frame * 16);
      seen.push(reveal.text);
    }

    expect(seen.length).toBeGreaterThan(0);
    for (let index = 0; index < seen.length; index += 1) {
      const text = seen[index] ?? '';
      expect(target.startsWith(text)).toBe(true);
      if (index > 0) {
        expect(text.length).toBeGreaterThanOrEqual((seen[index - 1] ?? '').length);
      }
    }
    expect(reveal.text).toBe(target);
    expect(reveal.done).toBe(true);
  });

  it('never shows half of an emoji', () => {
    const frames = manualFrames();
    const target = '👋🙂🎉 ok 🚀✨';
    const reveal = new SmoothTextReveal('', { frames: frames.scheduler, initial: 'zero' });
    reveal.setTarget(target);

    for (let frame = 0; frame <= 400 && !reveal.done; frame += 1) {
      frames.run(frame * 3);
      const last = reveal.text.charCodeAt(reveal.text.length - 1);
      expect(last >= 0xd800 && last <= 0xdbff).toBe(false);
    }
    expect(reveal.text).toBe(target);
  });

  it('clears a backlog within the catch-up window', () => {
    const frames = manualFrames();
    const target = 'x'.repeat(500);
    const reveal = new SmoothTextReveal('', { frames: frames.scheduler, initial: 'zero' });
    reveal.setTarget(target);

    const elapsed = runToDone(reveal, frames);

    expect(reveal.done).toBe(true);
    expect(elapsed).toBeLessThanOrEqual(SMOOTH_CATCH_UP_MS + 50);
  });

  it('keeps a minimum speed while there is a backlog', () => {
    const frames = manualFrames();
    const target = 'abcdefghij';
    const reveal = new SmoothTextReveal('', { frames: frames.scheduler, initial: 'zero' });
    reveal.setTarget(target);

    // The first frame only establishes the clock; the second one advances.
    frames.run(0);
    expect(reveal.text).toBe('');

    frames.run(100);
    const advanceAtOneSecond = (reveal.text.length * 1000) / 100;
    expect(advanceAtOneSecond).toBeGreaterThanOrEqual(SMOOTH_MIN_CHARS_PER_SECOND);
    expect(target.startsWith(reveal.text)).toBe(true);
  });

  it('restarts at the longest common prefix when the target shrinks', () => {
    const frames = manualFrames();
    const reveal = new SmoothTextReveal('Hello world', {
      frames: frames.scheduler,
      initial: 'zero',
    });
    runToDone(reveal, frames);
    expect(reveal.text).toBe('Hello world');

    reveal.setTarget('Hello there');
    expect(reveal.text).toBe('Hello ');

    runToDone(reveal, frames, 1000);
    expect(reveal.text).toBe('Hello there');
  });

  it('shows the target at once with reduced motion', () => {
    const frames = manualFrames();
    const reveal = new SmoothTextReveal('Hello there', {
      frames: frames.scheduler,
      reducedMotion: true,
      initial: 'zero',
    });

    expect(reveal.text).toBe('Hello there');
    expect(reveal.done).toBe(true);
    expect(frames.pending()).toBe(0);
  });

  it('paints the first target at once with initial full, then animates growth', () => {
    const frames = manualFrames();
    const reveal = new SmoothTextReveal('Hello', { frames: frames.scheduler, initial: 'full' });

    expect(reveal.text).toBe('Hello');
    expect(frames.pending()).toBe(0);

    reveal.setTarget('Hello there');
    expect(reveal.text).toBe('Hello');
    expect(reveal.done).toBe(false);

    runToDone(reveal, frames);
    expect(reveal.text).toBe('Hello there');
  });

  it('snaps to the current text when the app returns to active', () => {
    const frames = manualFrames();
    const listeners: Array<() => void> = [];
    const active: ActiveSource = {
      subscribe: (onActive) => {
        listeners.push(onActive);
        return () => {};
      },
    };
    const reveal = new SmoothTextReveal('Hello', {
      frames: frames.scheduler,
      initial: 'full',
      active,
    });

    // The app was backgrounded, so `requestAnimationFrame` was paused and the
    // backlog of the reply that arrived was never revealed frame by frame.
    reveal.setTarget('Hello, a reply arrived while the app was hidden');
    expect(reveal.done).toBe(false);

    for (const listener of listeners) {
      listener();
    }
    expect(reveal.text).toBe('Hello, a reply arrived while the app was hidden');
    expect(reveal.done).toBe(true);

    // A reply that keeps streaming after the return animates normally again.
    reveal.setTarget('Hello, a reply arrived while the app was hidden and kept going');
    expect(reveal.done).toBe(false);
    runToDone(reveal, frames, 1000);
    expect(reveal.text).toBe('Hello, a reply arrived while the app was hidden and kept going');
  });

  it('applies reduced motion when it turns on after construction', () => {
    const frames = manualFrames();
    const reveal = new SmoothTextReveal('', { frames: frames.scheduler, initial: 'zero' });
    reveal.setTarget('Hello there');
    expect(reveal.done).toBe(false);

    reveal.setOptions({ reducedMotion: true });
    expect(reveal.text).toBe('Hello there');
    expect(reveal.done).toBe(true);
    expect(frames.pending()).toBe(0);
  });

  it('animates when animation turns on after construction', () => {
    const frames = manualFrames();
    const reveal = new SmoothTextReveal('Hello', {
      animate: false,
      frames: frames.scheduler,
      initial: 'zero',
    });
    expect(reveal.text).toBe('Hello');

    reveal.setTarget('Hello there');
    expect(reveal.text).toBe('Hello there');

    reveal.setOptions({ animate: true });
    expect(reveal.text).toBe('Hello there');

    reveal.setTarget('Hello there, friend');
    expect(reveal.done).toBe(false);
    runToDone(reveal, frames);
    expect(reveal.text).toBe('Hello there, friend');
  });
});

describe('safeCut', () => {
  it('never cuts between the halves of a surrogate pair', () => {
    expect(safeCut('👋', 1)).toBe(2);
    expect(safeCut('a👋', 2)).toBe(3);
    expect(safeCut('ab', 1)).toBe(1);
  });
});
