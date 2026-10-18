import { StrictMode, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource-variable/geist';
import '@fontsource-variable/geist-mono';
import './index.css';
import { Effect } from 'effect';
import { BrowserRouter } from 'react-router';
import { AuthProvider } from '@/auth/AuthProvider';
import { AppRoutes } from '@/routes/AppRoutes';
import { ToastProvider } from '@/components/ui/toast';
import { ChatStoreProvider } from '@/store/ChatStoreProvider';
import { ensureServiceWorker, realPushBrowser, useServiceWorkerUpdate } from '@/lib/push';
import { runWeb } from '@/lib/effect/runtime';
import { Button } from './components/ui/button';
import { useClientVersionCheck as useSharedClientVersionCheck } from '@zilar/client-core';
import { protocolVersion } from '@zilar/protocol';
import { onForeground } from '@/lib/foreground';
import { isMockApiEnabled } from '@/mock/gate';
import { loadMockRequest } from '@/mock/load';

// A mock server answers /health with 404, so a mock session never shows the banner.
const healthRequest = (): Promise<Response> =>
  Effect.runPromise(
    Effect.promise(() =>
      isMockApiEnabled()
        ? loadMockRequest().then((dispatch) => dispatch('/health', { method: 'GET' }))
        : fetch('/health', { method: 'GET', credentials: 'same-origin' }),
    ),
  );

function useClientVersionCheck(): boolean {
  return useSharedClientVersionCheck(healthRequest, onForeground, protocolVersion);
}

/** A thin bar when this build is older than the server's minimum protocol, or after a deploy; it never blocks the app. */
function ClientVersionBanner({ reason }: { reason?: 'deploy' | undefined } = {}) {
  const outdated = useClientVersionCheck();

  if (!outdated && reason !== 'deploy') {
    return null;
  }

  return (
    <div
      role="status"
      className="fixed inset-x-0 top-0 z-50 border-b border-border bg-accent px-3 py-1.5 text-accent-foreground"
    >
      <div className="mx-auto flex w-full max-w-[860px] items-center justify-center gap-3">
        <span className="text-[13px]">A new version is available.</span>
        <Button type="button" variant="outline" size="sm" onClick={() => window.location.reload()}>
          Reload
        </Button>
      </div>
    </div>
  );
}

function App() {
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

const root = document.getElementById('root');

if (root === null) {
  throw new Error('Root element #root not found');
}

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
