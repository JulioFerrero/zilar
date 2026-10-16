'use client';

// effect-plain: DOM wiring for the landing canvas; the Promise edge is the WebGL scene's
// dynamic import, not app logic.
import { useEffect, useRef } from 'react';

// The fixed canvas behind the page. The scene is loaded with a dynamic `import()` after the text
// has painted, so the landing reads first; without WebGL nothing breaks and the page stays as is.
export function Planet() {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (canvas === null) return;
    const root = document.documentElement;
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    let disposed = false;
    import('./scene')
      .then(({ startScene }) => startScene(canvas, { reducedMotion }))
      .then(() => {
        if (!disposed) root.classList.add('webgl');
      })
      .catch(() => root.classList.add('no-webgl'));
    return () => {
      disposed = true;
    };
  }, []);

  return (
    <canvas
      id="gl"
      ref={ref}
      aria-hidden="true"
      style={{
        position: 'fixed',
        inset: 0,
        width: '100%',
        height: '100%',
        zIndex: 0,
        pointerEvents: 'none',
      }}
    />
  );
}
