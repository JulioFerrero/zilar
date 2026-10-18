import { Navigate, Outlet, Route, Routes, useLocation, useNavigate, useParams } from 'react-router';
import { lazy, Suspense, type ReactNode } from 'react';
import { useAuth } from '@/auth/AuthProvider';
import { SKELETON_DELAY_MS } from '@/components/Skeleton';
import { hasDismissedHandleGate } from '@/lib/handleGate';
import { useDelayed } from '@zilar/client-core';
import { AddContactRoute } from './AddContactRoute';
import { ChatShell } from './ChatShell';
import { GroupHandleRoute } from './GroupHandleRoute';
import { HandlePage } from './HandlePage';
import { AisPage } from './AisPage';
import { InvitePage } from './InvitePage';
import { JoinPage } from './JoinPage';
import { BlockedPage } from './BlockedPage';
import { ContactsPage } from './ContactsPage';
import { DevicesPage } from './DevicesPage';
import { RequestsPage } from './RequestsPage';
import { useChatStoreApi } from '@/store/ChatStoreProvider';
import { NamePage } from './NamePage';
import { ProfilePage } from './ProfilePage';
import { SettingsHubPage } from './SettingsHubPage';

// Settings, setup and login pages load on demand; the chat routes stay eager.
const ConnectionsPage = lazy(() =>
  import('./ConnectionsPage').then((m) => ({ default: m.ConnectionsPage })),
);
const LoginPage = lazy(() => import('./LoginPage').then((m) => ({ default: m.LoginPage })));
const FoldersPage = lazy(() => import('./FoldersPage').then((m) => ({ default: m.FoldersPage })));
const SetupPage = lazy(() => import('./SetupPage').then((m) => ({ default: m.SetupPage })));
const MachinesPage = lazy(() =>
  import('./MachinesPage').then((m) => ({ default: m.MachinesPage })),
);
const NotificationsPage = lazy(() =>
  import('./NotificationsPage').then((m) => ({ default: m.NotificationsPage })),
);
const IntegrationsPage = lazy(() =>
  import('./IntegrationsPage').then((m) => ({ default: m.IntegrationsPage })),
);
const StickersPage = lazy(() =>
  import('./StickersPage').then((m) => ({ default: m.StickersPage })),
);
const StickerPackPage = lazy(() =>
  import('./StickerPackPage').then((m) => ({ default: m.StickerPackPage })),
);
const ApprovalsPage = lazy(() =>
  import('./ApprovalsPage').then((m) => ({ default: m.ApprovalsPage })),
);
const RoutinesPage = lazy(() =>
  import('./RoutinesPage').then((m) => ({ default: m.RoutinesPage })),
);
const ExploreRoute = lazy(() =>
  import('./ExploreRoute').then((m) => ({ default: m.ExploreRoute })),
);

// The session check usually answers within a frame or two; this text only shows when it is
// slow, so a reload does not flash a Loading page.
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
  // People with an account but no handle are sent to the handle step once per browser
  // session; skip is allowed. Only when the handle is known-absent (null): while the user
  // or getMe() is loading (undefined) the gate does nothing, so there is no flash.
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
    <Suspense fallback={<LoadingScreen />}>
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
          element={
            <RequireAuth>
              <Outlet />
            </RequireAuth>
          }
        >
          <Route path="/" element={<ChatShell />} />
          <Route path="/c/:chatJid" element={<ChatShell />} />
          <Route path="/settings" element={<SettingsHubPage />} />
          <Route path="/settings/connections" element={<ConnectionsPage />} />
          <Route path="/settings/ais" element={<AisPage />} />
          <Route path="/settings/machines" element={<MachinesPage />} />
          <Route path="/settings/approvals" element={<ApprovalsPage />} />
          <Route path="/settings/routines" element={<RoutinesPage />} />
          <Route path="/settings/notifications" element={<NotificationsPage />} />
          <Route path="/settings/stickers" element={<StickersPage />} />
          <Route path="/stickers/:packId" element={<StickerPackPage />} />
          <Route path="/settings/profile" element={<ProfilePage />} />
          <Route path="/settings/requests" element={<RequestsRoute />} />
          <Route path="/settings/folders" element={<FoldersRoute />} />
          <Route path="/settings/blocked" element={<BlockedRoute />} />
          <Route path="/settings/contacts" element={<ContactsRoute />} />
          <Route path="/settings/devices" element={<DevicesRoute />} />
          <Route path="/explore" element={<ExploreRoute />} />
          <Route path="/settings/integrations" element={<IntegrationsPage />} />
        </Route>
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
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Suspense>
  );
}

// The join page needs the store's chat-list refresh after a join plus the General chat id
// to open; App wraps the routes in the provider, so the hook below is valid.
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
  return <RequestsPage onBack={() => navigate('/settings')} />;
}

function FoldersRoute() {
  const navigate = useNavigate();
  return <FoldersPage onBack={() => navigate('/settings')} />;
}

function BlockedRoute() {
  const navigate = useNavigate();
  return <BlockedPage onBack={() => navigate('/settings')} />;
}

function ContactsRoute() {
  const navigate = useNavigate();
  return <ContactsPage onBack={() => navigate('/settings')} />;
}

function DevicesRoute() {
  const navigate = useNavigate();
  return <DevicesPage onBack={() => navigate('/settings')} />;
}

// react-router cannot match /@:handle (a param must be a full segment), so this route
// checks the value itself; static routes always win over this dynamic one.
function AtHandleGate() {
  const params = useParams<{ atHandle?: string }>();
  const value = params.atHandle ?? '';
  if (!value.startsWith('@') || value.length < 2) {
    return <Navigate to="/" replace />;
  }
  return <GroupHandleRoute atHandle={value.slice(1)} />;
}
