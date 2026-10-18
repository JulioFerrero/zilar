import { useLayoutEffect, useRef, type ReactNode } from 'react';

/** Overlays the list and publishes its height as `--composer-h` so the list pads around it. */
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
