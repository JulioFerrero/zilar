import { commonPrefixLength, safeCut } from '@zilar/chat-core';
import { useEffect, useLayoutEffect, useReducer, useState } from 'react';

/**
 * The mobile port of the web's `useSmoothText` (`apps/web/src/lib/useSmoothText.ts`,
 * T-0045): the AI reply's text grows frame by frame instead of snapping in with
 * each throttled draft. The reveal and the final message share one bubble, so the
 * text never replays.
 *
 * The reveal engine is a plain class (`SmoothTextReveal`) so it can be tested in
 * Node with an injected clock and no renderer; `useSmoothText` is a thin hook over
 * it. React Native provides `requestAnimationFrame` at runtime.
 */

/** A frame scheduler seam so tests can drive the reveal deterministically. */
export interface FrameScheduler {
  request: (callback: (time: number) => void) => number;
  cancel: (handle: number) => void;
}

const defaultFrameScheduler: FrameScheduler = {
  request: (callback) =>
    typeof requestAnimationFrame === 'function' ? requestAnimationFrame(callback) : 0,
  cancel: (handle) => {
    if (typeof cancelAnimationFrame === 'function') {
      cancelAnimationFrame(handle);
    }
  },
};

/**
 * A foreground/background seam (React Native's `AppState`), so the reveal can
 * snap to the latest text when the app returns to `active`, the equivalent of
 * the web's hidden-tab snap (a hidden tab pauses `requestAnimationFrame`).
 */
export interface ActiveSource {
  subscribe: (onActive: () => void) => () => void;
}

/** Time the reveal takes to clear the whole backlog of one update. */
export const SMOOTH_CATCH_UP_MS = 350;

/** While there is a backlog, the reveal advances at least this fast. */
export const SMOOTH_MIN_CHARS_PER_SECOND = 60;

/** A long stall (a backgrounded app) must not flush the backlog in one frame. */
const MAX_FRAME_MS = 100;

export interface SmoothTextOptions {
  /** `false` shows `target` at once (a message that was never a draft). */
  animate?: boolean;
  /** Overrides the reduced-motion setting; the bubble passes Reanimated's. */
  reducedMotion?: boolean;
  /** The frame scheduler; tests inject a manual one. */
  frames?: FrameScheduler;
  /** The foreground source; tests inject a fake one. */
  active?: ActiveSource;
  /**
   * `'full'` paints the first target at once and animates only later growth, so
   * remounting a reply never replays its reveal. The chat UI uses it.
   */
  initial?: 'zero' | 'full';
  /** Called whenever the shown text changes; the hook re-renders from it. */
  onChange?: () => void;
}

export { safeCut };

/**
 * The reveal itself: `text` is always a prefix of the target and grows every
 * frame until it equals it. The speed adapts to the backlog so each update clears
 * within ~350 ms, with a floor so a slow stream still moves. A target that no
 * longer starts with the shown text (the model restarted the cumulative reply)
 * resumes at the longest common prefix. Reduced motion shows the target at once.
 */
export class SmoothTextReveal {
  private target: string;
  private shown: string;
  private progress: number;
  private velocity = 0;
  private handle: number | null = null;
  private last: number | null = null;
  private animate: boolean;
  private disposed = false;
  private readonly frames: FrameScheduler;
  private readonly onChange: (() => void) | undefined;
  private readonly unsubscribeActive: (() => void) | undefined;

  constructor(target: string, options: SmoothTextOptions = {}) {
    this.target = target;
    this.animate = (options.animate ?? true) && !(options.reducedMotion ?? false);
    this.frames = options.frames ?? defaultFrameScheduler;
    this.onChange = options.onChange;
    const initial = options.initial ?? 'zero';
    this.shown = this.animate ? (initial === 'full' ? target : '') : target;
    this.progress = this.shown.length;
    const active = options.active;
    this.unsubscribeActive = active !== undefined ? active.subscribe(() => this.snap()) : undefined;
    this.schedule();
  }

  get text(): string {
    return this.animate ? this.shown : this.target;
  }

  get done(): boolean {
    return this.text.length >= this.target.length;
  }

  /**
   * Applies `animate`/`reducedMotion` changes after construction. The bubble's
   * props can change (reduced motion can resolve, or a message can stop being a
   * draft). Turning animation off shows the target at once; turning it on
   * resumes the reveal from the current text.
   */
  setOptions(options: { animate?: boolean; reducedMotion?: boolean }): void {
    if (this.disposed) {
      return;
    }
    const next = (options.animate ?? true) && !(options.reducedMotion ?? false);
    if (next === this.animate) {
      return;
    }
    this.animate = next;
    if (!this.animate) {
      this.cancelFrame();
      this.velocity = 0;
      this.progress = this.target.length;
      this.shown = this.target;
      this.onChange?.();
      return;
    }
    this.schedule();
  }

  setTarget(target: string): void {
    if (this.disposed) {
      return;
    }
    this.target = target;
    if (!this.animate) {
      if (this.shown !== target) {
        this.shown = target;
        this.progress = target.length;
        this.onChange?.();
      }
      return;
    }
    if (!target.startsWith(this.shown)) {
      const prefix = target.slice(0, commonPrefixLength(this.shown, target));
      this.shown = prefix;
      this.progress = prefix.length;
      this.onChange?.();
    }
    this.schedule();
  }

  /** Shows the latest target at once (the app returned to the foreground). */
  snap(): void {
    if (this.disposed || !this.animate) {
      return;
    }
    const current = this.target;
    if (this.progress >= current.length) {
      return;
    }
    this.cancelFrame();
    this.velocity = 0;
    this.progress = current.length;
    this.shown = current;
    this.onChange?.();
  }

  dispose(): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    this.cancelFrame();
    this.unsubscribeActive?.();
  }

  private schedule(): void {
    if (this.disposed || !this.animate) {
      return;
    }
    const remaining = this.target.length - this.progress;
    this.cancelFrame();
    if (remaining <= 0) {
      this.velocity = 0;
      return;
    }
    this.velocity = Math.max(SMOOTH_MIN_CHARS_PER_SECOND, remaining / (SMOOTH_CATCH_UP_MS / 1000));
    this.last = null;
    this.handle = this.frames.request(this.step);
  }

  private readonly step = (time: number): void => {
    this.handle = null;
    if (this.disposed) {
      return;
    }
    const current = this.target;
    const elapsed = this.last === null ? 0 : Math.min(Math.max(time - this.last, 0), MAX_FRAME_MS);
    this.last = time;
    const backlog = current.length - this.progress;
    if (backlog <= 0) {
      return;
    }
    const advance = (this.velocity * elapsed) / 1000;
    const nextProgress = Math.min(current.length, this.progress + advance);
    this.progress = nextProgress;
    this.shown = current.slice(0, safeCut(current, nextProgress));
    this.onChange?.();
    if (nextProgress < current.length) {
      this.handle = this.frames.request(this.step);
    }
  };

  private cancelFrame(): void {
    if (this.handle !== null) {
      this.frames.cancel(this.handle);
      this.handle = null;
    }
  }
}

/**
 * Reveals `target` frame by frame as a prefix of it. It paints the first target
 * at once (`initial: 'full'`) so remounting a finished reply is normal, and only
 * animates growth after that. A message that was never a draft passes
 * `animate: false` and is shown whole. The returned `text` is what the bubble
 * renders; `done` is true once the reveal caught up.
 */
export function useSmoothText(
  target: string,
  options: SmoothTextOptions = {},
): { text: string; done: boolean } {
  const [, force] = useReducer((count: number) => count + 1, 0);
  // The reveal is created once; `force` re-renders on every text change.
  const [reveal] = useState(() => new SmoothTextReveal(target, { ...options, onChange: force }));

  useLayoutEffect(() => {
    reveal.setOptions({ animate: options.animate, reducedMotion: options.reducedMotion });
  }, [reveal, options.animate, options.reducedMotion]);

  useLayoutEffect(() => {
    reveal.setTarget(target);
  }, [reveal, target]);

  useEffect(() => () => reveal.dispose(), [reveal]);

  return { text: reveal.text, done: reveal.done };
}
