import { Toast } from '@base-ui/react/toast';
import { createContext, useCallback, useContext, type ReactNode } from 'react';

/** How long a toast stays on screen. */
const TOAST_MS = 2000;

/** Reusing one id makes a new toast replace the visible one and restart its timer. */
const TOAST_ID = 'zilar-toast';

type ToastFn = (text: string) => void;

const ToastContext = createContext<ToastFn | null>(null);

function ToastViewport() {
  const { toasts } = Toast.useToastManager();
  return (
    <Toast.Viewport className="pointer-events-none fixed inset-x-0 bottom-6 z-50 flex justify-center px-4">
      {toasts.map((toast) => (
        <Toast.Root
          key={toast.id}
          toast={toast}
          swipeDirection={[]}
          className="animate-in fade-in slide-in-from-bottom-2 rounded-full border border-border-strong bg-surface px-4 py-2 text-[13px] text-foreground shadow-[0_8px_24px_-8px_rgba(0,0,0,0.9)] duration-150 motion-reduce:animate-none"
        >
          <Toast.Title />
        </Toast.Root>
      ))}
    </Toast.Viewport>
  );
}

function ToastHost({ children }: { children: ReactNode }) {
  const { add } = Toast.useToastManager();
  const show = useCallback<ToastFn>(
    (text) => {
      add({ id: TOAST_ID, title: text, timeout: TOAST_MS });
    },
    [add],
  );

  return (
    <ToastContext.Provider value={show}>
      {children}
      <Toast.Portal>
        <ToastViewport />
      </Toast.Portal>
    </ToastContext.Provider>
  );
}

export function ToastProvider({ children }: { children: ReactNode }) {
  return (
    <Toast.Provider timeout={TOAST_MS}>
      <ToastHost>{children}</ToastHost>
    </Toast.Provider>
  );
}

export function useToast(): ToastFn {
  const show = useContext(ToastContext);
  if (show === null) {
    throw new Error('useToast must be used inside a ToastProvider');
  }
  return show;
}
