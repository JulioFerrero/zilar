import { type SmoothTextOptions, SmoothTextReveal } from '@zilar/chat-core';
import { useEffect, useLayoutEffect, useReducer, useState } from 'react';

/**
 * Reveals `target` frame by frame as a prefix of it, using the platform-neutral
 * `SmoothTextReveal` from `@zilar/chat-core`. It paints the first target at once
 * (`initial: 'full'`) so remounting a finished reply is normal, and only animates
 * growth after that. A message that was never a draft passes `animate: false`
 * and is shown whole. The returned `text` is what the bubble renders; `done` is
 * true once the reveal caught up.
 *
 * The platform adapters (`apps/web/src/lib/useSmoothText.ts` and
 * `apps/mobile/src/lib/use-smooth-text.ts`) add page visibility, `AppState` and
 * the reduced-motion setting; this hook stays plain React.
 */
export function useSmoothText(
  target: string,
  options: Omit<SmoothTextOptions, 'onChange'> = {},
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
