import { type SmoothTextOptions as CoreSmoothTextOptions } from '@zilar/chat-core';
import { useSmoothText as useCoreSmoothText } from '@zilar/client-core';
import { useSyncExternalStore } from 'react';

/** A visibility seam so tests can fake a tab becoming visible again. */
export interface VisibilitySource {
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

const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)';

function systemReducedMotion(): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    ? window.matchMedia(REDUCED_MOTION_QUERY).matches
    : false;
}

function subscribeReducedMotion(onChange: () => void): () => void {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return () => {};
  }
  const media = window.matchMedia(REDUCED_MOTION_QUERY);
  media.addEventListener('change', onChange);
  return () => media.removeEventListener('change', onChange);
}

/** The page's reduced-motion setting, kept current; a reducedMotion prop overrides it. */
function useReducedMotion(override: boolean | undefined): boolean {
  const system = useSyncExternalStore(subscribeReducedMotion, systemReducedMotion, () => false);
  return override ?? system;
}

export interface SmoothTextOptions extends Omit<CoreSmoothTextOptions, 'active'> {
  visibility?: VisibilitySource | undefined;
}

/** The web adapter around the shared reveal: page visibility stands in for the phone's
 * foreground source, and prefers-reduced-motion is watched while the page is open. */
export function useSmoothText(
  target: string,
  options: SmoothTextOptions = {},
): { text: string; done: boolean } {
  const reducedMotion = useReducedMotion(options.reducedMotion);
  return useCoreSmoothText(target, {
    animate: options.animate,
    reducedMotion,
    frames: options.frames,
    active: options.visibility ?? defaultVisibility,
    initial: options.initial,
  });
}
