import { Navigate, Route, Routes, useLocation, useNavigate, useParams } from 'react-router';
import type { ReactNode } from 'react';
import { useAuth } from '@/auth/AuthProvider';
import { SKELETON_DELAY_MS } from '@/components/Skeleton';
import { hasDismissedHandleGate } from '@/lib/handleGate';
import { useDelayed } from '@/lib/useDelayed';
import { AddContactRoute } from './AddContactRoute';
import { ChatShell } from './ChatShell';
import { GroupHandleRoute } from './GroupHandleRoute';
import { HandlePage } from './HandlePage';
import { AisPage } from './AisPage';
import { ConnectionsPage } from './ConnectionsPage';
import { InvitePage } from './InvitePage';
import { JoinPage } from './JoinPage';
import { LoginPage } from './LoginPage';
import { BlockedPage } from './BlockedPage';
import { FoldersPage } from './FoldersPage';
import { RequestsPage } from './RequestsPage';
import { SetupPage } from './SetupPage';
import { useChatStoreApi } from '@/store/ChatStoreProvider';
import { MachinesPage } from './MachinesPage';
import { NamePage } from './NamePage';
import { NotificationsPage } from './NotificationsPage';
import { IntegrationsPage } from './IntegrationsPage';
import { ProfilePage } from './ProfilePage';
import { StickersPage } from './StickersPage';
import { ApprovalsPage } from './ApprovalsPage';

// The session check usually answers within a frame or two; the text only
// shows when it is slow, so a reload doesn't flash a "Loading…" page.
function LoadingScreen() {
  const slow = useDelayed(true, SKELETON_DELAY_MS) === true;
  return (
    <div className="chat-background flex min-h-dvh items-center justify-center text-[15px] text-muted-foreground">
      {slow ? 'Loading…' : null}
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
  // T-0163: people who already have an account but no handle are sent to
  // the handle step once per browser session at their next visit; skip is
  // always allowed, so the app works without a handle. Only when the handle
  // is known-absent (`null`): while the user or `getMe()` is still loading
  // (`undefined`) the gate does nothing — no Navigate, no flash. The
  // dismissal lives in `lib/handleGate` (sessionStorage per user id, with
  // an in-memory fallback) and is honored here, so a skip is not asked
  // again until the next browser session.
  if (
    auth.user !== undefined &&
    auth.user.handle === null &&
    !hasDismissedHandleGate(auth.user.id) &&
    location.pathname !== '/welcome/handle' &&
    !location.pathname.startsWith('/welcome/handle/')
  ) {
    return (
      <Navigate
        to="/welcome/handle"
        replace
        state={{ next: `${location.pathname}${location.search}` }}
      />
    );
  }
  return children;
}

export function AppRoutes() {
  return (
    <Routes>
      <Route path="/invite/:code" element={<InvitePage />} />
      <Route path="/j/:token" element={<JoinRoute />} />
      <Route path="/login" element={<LoginPage />} />
      <Route path="/setup" element={<SetupPage />} />
      <Route
        path="/welcome/name"
        element={
          <RequireUser>
            <NamePage />
          </RequireUser>
        }
      />
      <Route
        path="/welcome/handle"
        element={
          <RequireUser>
            <HandlePage />
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
      <Route
        path="/settings/ais"
        element={
          <RequireAuth>
            <AisPage />
          </RequireAuth>
        }
      />
      <Route
        path="/settings/machines"
        element={
          <RequireAuth>
            <MachinesPage />
          </RequireAuth>
        }
      />
      <Route
        path="/settings/approvals"
        element={
          <RequireAuth>
            <ApprovalsPage />
          </RequireAuth>
        }
      />
      <Route
        path="/settings/notifications"
        element={
          <RequireAuth>
            <NotificationsPage />
          </RequireAuth>
        }
      />
      <Route
        path="/settings/stickers"
        element={
          <RequireAuth>
            <StickersPage />
          </RequireAuth>
        }
      />
      <Route
        path="/settings/profile"
        element={
          <RequireAuth>
            <ProfilePage />
          </RequireAuth>
        }
      />
      <Route
        path="/settings/requests"
        element={
          <RequireAuth>
            <RequestsRoute />
          </RequireAuth>
        }
      />
      <Route
        path="/settings/folders"
        element={
          <RequireAuth>
            <FoldersRoute />
          </RequireAuth>
        }
      />
      <Route
        path="/settings/blocked"
        element={
          <RequireAuth>
            <BlockedRoute />
          </RequireAuth>
        }
      />
      {/* Share links: /@handle opens the group card for a public group or
          the Add contact dialog for a person when logged in, and goes to
          login (returning afterwards) when logged out. react-router matches
          params only as full segments, so `/@:handle` never matches: instead
          a single-segment `/:atHandle` gate renders the handle route only
          for values starting with `@` and redirects anything else home
          (exactly like the catch-all below, so no real route is shadowed —
          static routes always win over dynamic ones). `/u/:handle` is the
          fallback for hosts that cannot serve `@` paths. All three sit
          outside the handle gate (which only guards the chat and settings
          pages), so a share link never redirects to /welcome/handle. */}
      <Route path="/u/:handle" element={<AddContactRoute />} />
      <Route path="/:atHandle" element={<AtHandleGate />} />
      <Route
        path="/settings/integrations"
        element={
          <RequireAuth>
            <IntegrationsPage />
          </RequireAuth>
        }
      />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

// The join page needs the store's chat-list refresh after a successful join
// plus the General chat id to open; `App` wraps the routes in the provider,
// so the hook below is valid.
function JoinRoute() {
  const storeApi = useChatStoreApi();
  return (
    <JoinPage
      refreshChats={() => storeApi.getState().refreshChats()}
      openGroupChat={(groupId) => storeApi.getState().refreshGeneralTopic(groupId)}
    />
  );
}

function RequestsRoute() {
  const navigate = useNavigate();
  return <RequestsPage onBack={() => navigate('/')} />;
}

function FoldersRoute() {
  const navigate = useNavigate();
  return <FoldersPage onBack={() => navigate('/')} />;
}

function BlockedRoute() {
  const navigate = useNavigate();
  return <BlockedPage onBack={() => navigate('/')} />;
}

// The `/@handle` gate: react-router cannot match `/@:handle` (a param must
// be a full segment), so this single-segment route checks the value itself.
// Values starting with `@` render the handle route (a public group card or
// the Add contact dialog for a person); anything else (including a bare
// `/@`) redirects home, exactly like the catch-all below. Static routes
// (`/login`, `/settings/*`, …) always win over this dynamic one, so no
// real route is shadowed.
function AtHandleGate() {
  const params = useParams<{ atHandle?: string }>();
  const value = params.atHandle ?? '';
  if (!value.startsWith('@') || value.length < 2) {
    return <Navigate to="/" replace />;
  }
  return <GroupHandleRoute atHandle={value.slice(1)} />;
}
