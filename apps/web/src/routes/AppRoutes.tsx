import { Navigate, Route, Routes, useLocation } from 'react-router';
import type { ReactNode } from 'react';
import { useAuth } from '@/auth/AuthProvider';
import { ChatShell } from './ChatShell';
import { ConnectionsPage } from './ConnectionsPage';
import { InvitePage } from './InvitePage';
import { LoginPage } from './LoginPage';
import { NamePage } from './NamePage';

function LoadingScreen() {
  return (
    <div className="chat-background flex min-h-dvh items-center justify-center text-[15px] text-muted-foreground">
      Loading…
    </div>
  );
}

function RequireUser({ children }: { children: ReactNode }) {
  const auth = useAuth();
  if (auth.status === 'loading') {
    return <LoadingScreen />;
  }
  if (auth.status === 'guest') {
    return <Navigate to="/login" replace />;
  }
  return children;
}

/** Requires a session and a display name; preserves the target for after login. */
function RequireAuth({ children }: { children: ReactNode }) {
  const auth = useAuth();
  const location = useLocation();
  if (auth.status === 'loading') {
    return <LoadingScreen />;
  }
  if (auth.status === 'guest') {
    return (
      <Navigate to="/login" replace state={{ from: `${location.pathname}${location.search}` }} />
    );
  }
  if ((auth.user?.name ?? '').trim() === '') {
    return <Navigate to="/welcome/name" replace />;
  }
  return children;
}

export function AppRoutes() {
  return (
    <Routes>
      <Route path="/invite/:code" element={<InvitePage />} />
      <Route path="/login" element={<LoginPage />} />
      <Route
        path="/welcome/name"
        element={
          <RequireUser>
            <NamePage />
          </RequireUser>
        }
      />
      <Route
        path="/"
        element={
          <RequireAuth>
            <ChatShell />
          </RequireAuth>
        }
      />
      <Route
        path="/c/:chatJid"
        element={
          <RequireAuth>
            <ChatShell />
          </RequireAuth>
        }
      />
      <Route
        path="/settings/connections"
        element={
          <RequireAuth>
            <ConnectionsPage />
          </RequireAuth>
        }
      />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
