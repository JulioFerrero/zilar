import { Effect } from 'effect';
import { useEffect } from 'react';
import { BrowserRouter } from 'react-router';
import { AuthProvider } from '@/auth/AuthProvider';
import { AppRoutes } from '@/routes/AppRoutes';
import { ClientVersionBanner } from '@/components/ClientVersionBanner';
import { ToastProvider } from '@/components/ui/toast';
import { ChatStoreProvider } from '@/store/ChatStoreProvider';
import { ensureServiceWorker, realPushBrowser, useServiceWorkerUpdate } from '@/lib/push';
import { runWeb } from '@/lib/effect/runtime';

export function App() {
  // A new deploy's worker keeps this page on the old bundle until Reload; a first install is not an update.
  const serviceWorkerUpdated = useServiceWorkerUpdate();

  // Idempotent; never caches API or app traffic, and a failed registration is ignored.
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
            <ClientVersionBanner reason={serviceWorkerUpdated ? 'deploy' : undefined} />
            <AppRoutes />
          </BrowserRouter>
        </ToastProvider>
      </ChatStoreProvider>
    </AuthProvider>
  );
}
