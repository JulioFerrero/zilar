import { useEffect, useLayoutEffect, useRef, useState } from 'react';

/** A frame scheduler seam so tests can drive the reveal deterministically. */
export interface FrameScheduler {
  request: (callback: (time: number) => void) => number;
  cancel: (handle: number) => void;
}

const defaultFrameScheduler: FrameScheduler = {
  request: (callback) => requestAnimationFrame(callback),
  cancel: (handle) => cancelAnimationFrame(handle),
};

/** A visibility seam so tests can fake a tab becoming visible again. */
export interface VisibilitySource {
  /** Calls `onVisible` whenever the page becomes visible. Returns an unsubscribe. */
  subscribe: (onVisible: () => void) => () => void;
}

const defaultVisibility: VisibilitySource = {
  subscribe: (onVisible) => {
    if (typeof document === 'undefined') {
      return () => {};
    }
    const handler = (): void => {
      if (!document.hidden) {
        onVisible();
      }
    };
    document.addEventListener('visibilitychange', handler);
    return () => document.removeEventListener('visibilitychange', handler);
  },
};

/** Time the reveal takes to clear the whole backlog of one update. */
export const SMOOTH_CATCH_UP_MS = 350;

/** While there is a backlog, the reveal advances at least this fast. */
export const SMOOTH_MIN_CHARS_PER_SECOND = 60;

/** A long stall (a hidden tab) must not flush the backlog in a single frame. */
const MAX_FRAME_MS = 100;

function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    ? window.matchMedia('(prefers-reduced-motion: reduce)').matches
    : false;
}

function commonPrefixLength(left: string, right: string): number {
  const max = Math.min(left.length, right.length);
  let index = 0;
  while (index < max && left[index] === right[index]) {
    index += 1;
  }
  return index;
}

export interface SmoothTextOptions {
  /** `false` shows `target` at once (a message that was never a draft). */
  animate?: boolean;
  /** Overrides the `prefers-reduced-motion` media query. */
  reducedMotion?: boolean;
  /** The frame scheduler; tests inject a manual one. */
  frames?: FrameScheduler;
  /** The visibility source; tests inject a fake one. */
  visibility?: VisibilitySource;
  /**
   * `'full'` paints the first target at once and animates only later growth,
   * so remounting a reply never replays its reveal. The chat UI uses it.
   */
  initial?: 'zero' | 'full';
}

/**
 * Reveals `target` frame by frame. `text` is always a prefix of `target`; the
 * speed adapts to the backlog so each update clears within ~350 ms, with a
 * floor so a slow stream still moves. A target that no longer starts with the
 * shown text (the model restarted the cumulative reply) resumes at the longest
 * common prefix. With reduced motion, `text` is `target` at once.
 */
export function useSmoothText(
  target: string,
  options: SmoothTextOptions = {},
): { text: string; done: boolean } {
  const frames = options.frames ?? defaultFrameScheduler;
  const [reduced] = useState(() => options.reducedMotion ?? prefersReducedMotion());
  const animate = (options.animate ?? true) && !reduced;
  const initial = options.initial ?? 'zero';
  const initialText = animate ? (initial === 'full' ? target : '') : target;

  const [shown, setShown] = useState(initialText);
  const shownRef = useRef(initialText);
  const progressRef = useRef(initialText.length);
  const targetRef = useRef(target);
  const velocityRef = useRef(0);
  const handleRef = useRef<number | null>(null);
  const lastRef = useRef<number | null>(null);

  // Reconcile before paint: a target that restarted (the model called a tool)
  // resumes at the longest common prefix instead of flashing the new text.
  useLayoutEffect(() => {
    targetRef.current = target;
    const shownText = shownRef.current;
    if (!animate) {
      if (shownRef.current !== target) {
        shownRef.current = target;
        progressRef.current = target.length;
        setShown(target);
      }
      return;
    }
    if (!target.startsWith(shownText)) {
      const prefix = target.slice(0, commonPrefixLength(shownText, target));
      shownRef.current = prefix;
      progressRef.current = prefix.length;
      setShown(prefix);
    }
  }, [target, animate]);

  useEffect(() => {
    if (!animate) {
      return;
    }
    const remaining = target.length - progressRef.current;
    if (remaining <= 0) {
      velocityRef.current = 0;
      return;
    }
    velocityRef.current = Math.max(
      SMOOTH_MIN_CHARS_PER_SECOND,
      remaining / (SMOOTH_CATCH_UP_MS / 1000),
    );
    let cancelled = false;
    lastRef.current = null;
    const step = (time: number): void => {
      if (cancelled) {
        return;
      }
      const current = targetRef.current;
      const elapsed =
        lastRef.current === null ? 0 : Math.min(Math.max(time - lastRef.current, 0), MAX_FRAME_MS);
      lastRef.current = time;
      const backlog = current.length - progressRef.current;
      if (backlog <= 0) {
        return;
      }
      const advance = (velocityRef.current * elapsed) / 1000;
      const nextProgress = Math.min(current.length, progressRef.current + advance);
      progressRef.current = nextProgress;
      shownRef.current = current.slice(0, safeCut(current, nextProgress));
      setShown(shownRef.current);
      if (nextProgress < current.length) {
        handleRef.current = frames.request(step);
      }
    };
    handleRef.current = frames.request(step);
    return () => {
      cancelled = true;
      if (handleRef.current !== null) {
        frames.cancel(handleRef.current);
        handleRef.current = null;
      }
    };
  }, [target, animate, frames]);

  // Browsers pause `requestAnimationFrame` in a hidden tab, so a reply written
  // while the tab was hidden would otherwise animate only once it comes back.
  // Snap to the latest text on return; a reply still streaming then animates
  // normally for every update that follows.
  useEffect(() => {
    if (!animate) {
      return;
    }
    const source = options.visibility ?? defaultVisibility;
    return source.subscribe(() => {
      const current = targetRef.current;
      if (progressRef.current >= current.length) {
        return;
      }
      if (handleRef.current !== null) {
        frames.cancel(handleRef.current);
        handleRef.current = null;
      }
      velocityRef.current = 0;
      progressRef.current = current.length;
      shownRef.current = current;
      setShown(current);
    });
  }, [animate, frames, options.visibility]);

  const text = animate ? shown : target;
  return { text, done: text.length >= target.length };
}

// Never cut between the two halves of a surrogate pair (most emoji): a half
// renders as a replacement glyph for a frame.
function safeCut(text: string, progress: number): number {
  const end = Math.floor(progress);
  const last = text.charCodeAt(end - 1);
  return end > 0 && end < text.length && last >= 0xd800 && last <= 0xdbff ? end + 1 : end;
}
