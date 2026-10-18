// effect-plain: a short UI timer for a presentational toast; no I/O or ports.
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';

/** How long a toast stays on screen. */
const TOAST_MS = 2000;

type Toast = (text: string) => void;

const ToastContext = createContext<Toast | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [text, setText] = useState<string | null>(null);
  const timerRef = useRef<number | undefined>(undefined);

  const show = useCallback<Toast>((next) => {
    setText(next);
    if (timerRef.current !== undefined) {
      window.clearTimeout(timerRef.current);
    }
    timerRef.current = window.setTimeout(() => setText(null), TOAST_MS);
  }, []);

  useEffect(
    () => () => {
      if (timerRef.current !== undefined) {
        window.clearTimeout(timerRef.current);
      }
    },
    [],
  );

  return (
    <ToastContext.Provider value={show}>
      {children}
      <div
        role="status"
        aria-live="polite"
        className="pointer-events-none fixed inset-x-0 bottom-6 z-50 flex justify-center px-4"
      >
        {text !== null && (
          <div className="animate-in fade-in slide-in-from-bottom-2 rounded-full border border-border-strong bg-surface px-4 py-2 text-[13px] text-foreground shadow-[0_8px_24px_-8px_rgba(0,0,0,0.9)] duration-150 motion-reduce:animate-none">
            {text}
          </div>
        )}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): Toast {
  const show = useContext(ToastContext);
  if (show === null) {
    throw new Error('useToast must be used inside a ToastProvider');
  }
  return show;
}
