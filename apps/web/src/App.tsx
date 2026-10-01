import { useEffect } from 'react';
import { BrowserRouter } from 'react-router';
import { AuthProvider } from '@/auth/AuthProvider';
import { AppRoutes } from '@/routes/AppRoutes';
import { ChatStoreProvider } from '@/store/ChatStoreProvider';
import { ensureServiceWorker, realPushBrowser } from '@/lib/push';

export function App() {
  // Registers the app service worker once (push + click + offline page).
  // Idempotent and harmless in dev: it never caches API or app traffic.
  useEffect(() => {
    const browser = realPushBrowser();
    if (browser !== undefined) {
      ensureServiceWorker(browser).catch(() => undefined);
    }
  }, []);
  return (
    <AuthProvider>
      <ChatStoreProvider>
        <BrowserRouter>
          <AppRoutes />
        </BrowserRouter>
      </ChatStoreProvider>
    </AuthProvider>
  );
}
