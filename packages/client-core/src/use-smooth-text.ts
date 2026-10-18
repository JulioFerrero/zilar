import { type SmoothTextOptions, SmoothTextReveal } from '@zilar/chat-core';
import { useEffect, useLayoutEffect, useReducer, useState } from 'react';

/**
 * Reveals `target` frame by frame as a prefix of it, using the platform-neutral
 * `SmoothTextReveal`. It paints the first target at once, so remounting a finished reply
 * is normal, and only animates growth; a message that was never a draft passes
 * `animate: false` and is shown whole. The app adapters add visibility and reduced motion.
 */
export function useSmoothText(
  target: string,
  options: Omit<SmoothTextOptions, 'onChange'> = {},
): { text: string; done: boolean } {
  const [, force] = useReducer((count: number) => count + 1, 0);
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
