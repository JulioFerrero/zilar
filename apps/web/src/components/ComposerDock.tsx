import { useLayoutEffect, useRef, type ReactNode } from 'react';

/**
 * The floating bottom bar (T-1937): it overlays the message list instead of
 * taking a row under it. Its height is published as `--composer-h` on the
 * wrapping column, so the list can pad its content and lift its jump button
 * above the composer while messages scroll under it.
 */
export function ComposerDock({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const dock = ref.current;
    if (dock === null) {
      return;
    }
    const host = dock.parentElement;
    if (host === null) {
      return;
    }
    const publish = (): void => {
      host.style.setProperty('--composer-h', `${dock.offsetHeight}px`);
    };
    publish();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(publish);
    observer?.observe(dock);
    return () => {
      observer?.disconnect();
      host.style.removeProperty('--composer-h');
    };
  }, []);

  return (
    <div ref={ref} className="pointer-events-none absolute inset-x-0 bottom-0 z-10">
      {children}
    </div>
  );
}
