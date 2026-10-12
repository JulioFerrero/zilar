import { Effect } from 'effect';
import { useEffect } from 'react';
import { BrowserRouter } from 'react-router';
import { AuthProvider } from '@/auth/AuthProvider';
import { AppRoutes } from '@/routes/AppRoutes';
import { ToastProvider } from '@/components/ui/toast';
import { ChatStoreProvider } from '@/store/ChatStoreProvider';
import { ensureServiceWorker, realPushBrowser } from '@/lib/push';
import { runWeb } from '@/lib/effect/runtime';

export function App() {
  // Registers the app service worker once (push + click + offline page).
  // Idempotent and harmless in dev: it never caches API or app traffic.
  // A failed registration is ignored, as before.
  useEffect(() => {
    const browser = realPushBrowser();
    if (browser !== undefined) {
      void runWeb(Effect.promise(() => ensureServiceWorker(browser)).pipe(Effect.ignore));
    }
  }, []);
  return (
    <AuthProvider>
      <ChatStoreProvider>
        <ToastProvider>
          <BrowserRouter>
            <AppRoutes />
          </BrowserRouter>
        </ToastProvider>
      </ChatStoreProvider>
    </AuthProvider>
  );
}
