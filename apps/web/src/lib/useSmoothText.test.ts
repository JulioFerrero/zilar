import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import {
  SMOOTH_CATCH_UP_MS,
  SMOOTH_MIN_CHARS_PER_SECOND,
  type FrameScheduler,
  type VisibilitySource,
  useSmoothText,
} from './useSmoothText';

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

describe('useSmoothText', () => {
  it('grows monotonically and always stays a prefix of the target', () => {
    const frames = manualFrames();
    const target = 'Hello there, this is a longer reply';
    const { result, rerender } = renderHook(
      ({ value }: { value: string }) =>
        useSmoothText(value, { frames: frames.scheduler, initial: 'zero' }),
      { initialProps: { value: '' } },
    );

    rerender({ value: target });

    const seen: string[] = [];
    for (let frame = 0; frame <= 200 && !result.current.done; frame += 1) {
      act(() => {
        frames.run(frame * 16);
      });
      seen.push(result.current.text);
    }

    expect(seen.length).toBeGreaterThan(0);
    for (let index = 0; index < seen.length; index += 1) {
      const text = seen[index] ?? '';
      expect(target.startsWith(text)).toBe(true);
      if (index > 0) {
        expect(text.length).toBeGreaterThanOrEqual((seen[index - 1] ?? '').length);
      }
    }
    expect(result.current.text).toBe(target);
    expect(result.current.done).toBe(true);
  });

  it('never shows half of an emoji', () => {
    const frames = manualFrames();
    const target = '👋🙂🎉 ok 🚀✨';
    const { result, rerender } = renderHook(
      ({ value }: { value: string }) =>
        useSmoothText(value, { frames: frames.scheduler, initial: 'zero' }),
      { initialProps: { value: '' } },
    );
    rerender({ value: target });

    for (let frame = 0; frame <= 400 && !result.current.done; frame += 1) {
      act(() => {
        frames.run(frame * 3);
      });
      const last = result.current.text.charCodeAt(result.current.text.length - 1);
      expect(last >= 0xd800 && last <= 0xdbff).toBe(false);
    }
    expect(result.current.text).toBe(target);
  });

  it('clears a backlog within the catch-up window', () => {
    const frames = manualFrames();
    const target = 'x'.repeat(500);
    const { result, rerender } = renderHook(
      ({ value }: { value: string }) =>
        useSmoothText(value, { frames: frames.scheduler, initial: 'zero' }),
      { initialProps: { value: '' } },
    );

    rerender({ value: target });

    let elapsed = 0;
    for (let frame = 0; frame <= 200 && !result.current.done; frame += 1) {
      elapsed = frame * 16;
      act(() => {
        frames.run(elapsed);
      });
    }

    expect(result.current.done).toBe(true);
    expect(elapsed).toBeLessThanOrEqual(SMOOTH_CATCH_UP_MS + 50);
  });

  it('keeps a minimum speed while there is a backlog', () => {
    const frames = manualFrames();
    const target = 'abcdefghij';
    const { result, rerender } = renderHook(
      ({ value }: { value: string }) =>
        useSmoothText(value, { frames: frames.scheduler, initial: 'zero' }),
      { initialProps: { value: '' } },
    );

    rerender({ value: target });

    // The first frame only establishes the clock; the second one advances.
    act(() => {
      frames.run(0);
    });
    expect(result.current.text).toBe('');

    act(() => {
      frames.run(100);
    });
    const advanceAtOneSecond = (result.current.text.length * 1000) / 100;
    expect(advanceAtOneSecond).toBeGreaterThanOrEqual(SMOOTH_MIN_CHARS_PER_SECOND);
    expect(target.startsWith(result.current.text)).toBe(true);
  });

  it('restarts at the longest common prefix when the target shrinks', () => {
    const frames = manualFrames();
    const { result, rerender } = renderHook(
      ({ value }: { value: string }) =>
        useSmoothText(value, { frames: frames.scheduler, initial: 'zero' }),
      { initialProps: { value: 'Hello world' } },
    );

    for (let frame = 0; frame <= 200 && !result.current.done; frame += 1) {
      act(() => {
        frames.run(frame * 16);
      });
    }
    expect(result.current.text).toBe('Hello world');

    rerender({ value: 'Hello there' });
    expect(result.current.text).toBe('Hello ');

    for (let frame = 0; frame <= 200 && !result.current.done; frame += 1) {
      act(() => {
        frames.run(1000 + frame * 16);
      });
    }
    expect(result.current.text).toBe('Hello there');
  });

  it('shows the target at once with reduced motion', () => {
    const frames = manualFrames();
    const { result } = renderHook(() =>
      useSmoothText('Hello there', {
        frames: frames.scheduler,
        reducedMotion: true,
        initial: 'zero',
      }),
    );

    expect(result.current.text).toBe('Hello there');
    expect(result.current.done).toBe(true);
    expect(frames.pending()).toBe(0);
  });

  it('paints the first target at once with initial full, then animates growth', () => {
    const frames = manualFrames();
    const { result, rerender } = renderHook(
      ({ value }: { value: string }) =>
        useSmoothText(value, { frames: frames.scheduler, initial: 'full' }),
      { initialProps: { value: 'Hello' } },
    );

    expect(result.current.text).toBe('Hello');
    expect(frames.pending()).toBe(0);

    rerender({ value: 'Hello there' });
    expect(result.current.text).toBe('Hello');
    expect(result.current.done).toBe(false);

    for (let frame = 0; frame <= 200 && !result.current.done; frame += 1) {
      act(() => {
        frames.run(frame * 16);
      });
    }
    expect(result.current.text).toBe('Hello there');
  });

  it('snaps to the current text when the page becomes visible again', () => {
    const frames = manualFrames();
    const listeners: Array<() => void> = [];
    const visibility: VisibilitySource = {
      subscribe: (onVisible) => {
        listeners.push(onVisible);
        return () => {};
      },
    };
    const { result, rerender } = renderHook(
      ({ value }: { value: string }) =>
        useSmoothText(value, { frames: frames.scheduler, initial: 'full', visibility }),
      { initialProps: { value: 'Hello' } },
    );

    // The tab is hidden, so `requestAnimationFrame` is paused and the backlog
    // of the reply that arrived is never revealed frame by frame.
    rerender({ value: 'Hello, a reply arrived while the tab was hidden' });
    expect(result.current.done).toBe(false);

    act(() => {
      for (const listener of listeners) {
        listener();
      }
    });
    expect(result.current.text).toBe('Hello, a reply arrived while the tab was hidden');
    expect(result.current.done).toBe(true);

    // A reply that keeps streaming after the return animates normally again.
    rerender({ value: 'Hello, a reply arrived while the tab was hidden and kept going' });
    expect(result.current.done).toBe(false);
    for (let frame = 0; frame <= 200 && !result.current.done; frame += 1) {
      act(() => {
        frames.run(1000 + frame * 16);
      });
    }
    expect(result.current.text).toBe(
      'Hello, a reply arrived while the tab was hidden and kept going',
    );
  });
});
