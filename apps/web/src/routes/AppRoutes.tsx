import { BlockedPage } from './BlockedPage';
import { ChatView } from './ChatView';
import { ContactsPage } from './ContactsPage';
import { DevicesPage } from './DevicesPage';
import { GroupHandleRoute } from './GroupHandleRoute';
import { HandlePage } from './HandlePage';
import { JoinPage } from './JoinPage';
import { RequestsPage } from './RequestsPage';
import { SettingsHubPage } from './SettingsHubPage';
import { useAuth } from '@/auth/AuthProvider';
import { AddContactDialog } from '@/components/AddContactDialog';
import { AiHealthRow } from '@/components/ais/AiHealthRow';
import { providerLabel } from '@/components/ais/ConnectionPicker';
import { aiFailureText } from '@/components/ais/errors';
import { NewAiDialog } from '@/components/ais/NewAiDialog';
import { AuthFlow } from '@/components/auth/AuthFlow';
import { ChatList } from '@/components/ChatList';
import { EmptyState } from '@/components/EmptyState';
import { FolderRail } from '@/components/FolderRail';
import { ProfileSettingsSection } from '@/components/ProfileSettingsSection';
import { SETTINGS_COLUMN, SettingsShell } from '@/components/SettingsShell';
import { SKELETON_DELAY_MS } from '@/components/Skeleton';
import { Button } from '@/components/ui/button';
import { StateMessage } from '@/components/ui/state-message';
import { TextInput } from '@/components/ui/text-input';
import { listAis, listConnections, type PublicAi, updateMe } from '@/lib/api';
import { shownFailure, failureOf, isWaiting, useAction } from '@/lib/effect/use-action';
import { useQuery } from '@/lib/effect/use-query';
import { hasDismissedHandleGate } from '@/lib/handleGate';
import { useChatFolders } from '@/lib/useChatFolders';
import { useMediaQuery } from '@/lib/useMediaQuery';
import { cn } from '@/lib/utils';
import { useChatStoreApi, useChatSelector } from '@/store/ChatStoreProvider';
import { safeDecode } from '@zilar/chat-core';
import { useDelayed, fromApi } from '@zilar/client-core';
import { Effect, Data } from 'effect';
import { AsyncResult } from 'effect/reactivity';
import { Plus, Zap } from 'lucide-react';
import { lazy, Suspense, type ReactNode, useState, useEffect } from 'react';
import { Navigate, Outlet, Route, Routes, useLocation, useNavigate, useParams } from 'react-router';
/** Share entry points: /u/:handle and /@handle. Logged in opens the Add contact dialog
 * prefilled; logged out goes to login and returns to the real URL afterwards. */

function AddContactRoute({ atHandle }: { atHandle?: string | undefined }) {
  const auth = useAuth();
  const params = useParams<{ handle?: string }>();
  const location = useLocation();
  const navigate = useNavigate();
  const [open, setOpen] = useState(true);

  // The real URL the visitor opened, recorded for the login return trip.
  const here = `${location.pathname}${location.search}`;
  const handle = atHandle ?? params.handle ?? '';

  if (auth.status === 'loading') {
    return null;
  }
  if (auth.status === 'guest') {
    return <Navigate to="/login" replace state={{ from: here }} />;
  }

  const close = (): void => {
    setOpen(false);
    navigate('/', { replace: true });
  };

  if (!open) {
    return null;
  }
  // Keyed by handle so /@alice then /@bob re-seeds the dialog state.
  return <AddContactDialog key={handle} initialHandle={handle} onClose={close} />;
}

function ProfilePage() {
  const navigate = useNavigate();
  return (
    <SettingsShell
      title="Profile"
      subtitle="Your picture and username, seen by your contacts."
      onBack={() => navigate('/settings')}
    >
      <div className={SETTINGS_COLUMN}>
        <ProfileSettingsSection />
      </div>
    </SettingsShell>
  );
}

function InvitePage() {
  // A missing code is undefined, so the invite step starts with an empty field.
  const { code } = useParams<{ code: string }>();
  return <AuthFlow inviteCode={code} heading="You're invited to Zilar" />;
}

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

function decodeParam(value: string | undefined): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  return safeDecode(value);
}

function ChatShell() {
  const params = useParams<{ chatJid?: string }>();
  const chatId = decodeParam(params.chatJid);
  const chat = useChatSelector((s) =>
    chatId === undefined ? undefined : s.chats.find((item) => item.id === chatId),
  );
  const navigate = useNavigate();
  const isWide = useMediaQuery('(min-width: 900px)');
  // On a wide layout Esc closes the open chat too. Skip while a search is open: the first
  // Escape clears it, the next closes the chat.
  const searchOpen = useChatSelector((s) => s.search.trim() !== '' || s.searchChat !== undefined);
  useChatFolders();

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape' || chatId === undefined) {
        return;
      }
      // An Escape a dialog, menu or the composer already handled never closes the chat too.
      if (event.defaultPrevented) {
        return;
      }
      if (isWide && searchOpen) {
        return;
      }
      navigate('/');
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isWide, chatId, navigate, searchOpen]);

  // Alt+Up/Down opens the previous/next chat in the list, even while the composer has
  // focus; there is no wrap at either end.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (
        !event.altKey ||
        event.ctrlKey ||
        event.metaKey ||
        (event.key !== 'ArrowUp' && event.key !== 'ArrowDown')
      ) {
        return;
      }
      if (event.defaultPrevented) {
        return;
      }
      const links = Array.from(
        document.querySelectorAll<HTMLAnchorElement>('nav[aria-label="Chats"] a[data-topic-row]'),
      );
      const index = links.findIndex((link) => link.getAttribute('aria-current') === 'page');
      const next =
        index === -1
          ? event.key === 'ArrowDown'
            ? links[0]
            : undefined
          : links[event.key === 'ArrowDown' ? index + 1 : index - 1];
      if (next === undefined) {
        return;
      }
      event.preventDefault();
      navigate(next.getAttribute('href') ?? '/');
      next.scrollIntoView({ block: 'nearest' });
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [navigate]);

  return (
    <div className="flex h-dvh w-full overflow-hidden bg-page wide:gap-3 wide:p-3">
      {isWide && <FolderRail />}
      <aside
        className={cn(
          'h-full w-full min-w-0 flex-col bg-panel wide:w-[360px] wide:shrink-0 wide:overflow-hidden wide:rounded-2xl wide:border wide:border-border',
          chatId === undefined ? 'flex' : 'hidden wide:flex',
        )}
      >
        <ChatList activeChatId={chatId} />
      </aside>
      <main
        className={cn(
          'h-full min-w-0 flex-1 flex-col bg-panel wide:overflow-hidden wide:rounded-2xl wide:border wide:border-border',
          chatId === undefined ? 'hidden wide:flex' : 'flex',
        )}
      >
        {chat !== undefined ? (
          <ChatView key={chat.id} chat={chat} />
        ) : (
          <EmptyState variant="no-chat-selected" />
        )}
      </main>
    </div>
  );
}

function AisPage() {
  const navigate = useNavigate();

  const [list, reload] = useQuery(() => fromApi(() => listAis()), []);
  const ais = AsyncResult.isSuccess(list) ? list.value : undefined;
  const [providers] = useQuery(() => providerNamesOf(ais ?? []), [ais]);
  const providerNames: Record<string, string> = AsyncResult.isSuccess(providers)
    ? providers.value
    : {};

  const [removedIds, setRemovedIds] = useState<ReadonlySet<string>>(() => new Set());
  const [creating, setCreating] = useState(false);

  const loadError = shownFailure(list);
  const visible = (ais ?? []).filter((ai) => !removedIds.has(ai.id));

  const markRemoved = (id: string): void => {
    setRemovedIds((ids) => new Set(ids).add(id));
  };

  return (
    <SettingsShell
      title="My AIs"
      action={
        <Button
          type="button"
          size="lg"
          className="rounded-full px-5"
          onClick={() => setCreating(true)}
        >
          <Plus aria-hidden="true" />
          New AI
        </Button>
      }
      onBack={() => navigate('/settings')}
    >
      <div className={SETTINGS_COLUMN}>
        {loadError === undefined && ais === undefined && (
          <StateMessage kind="loading" title="Loading…" />
        )}

        {loadError !== undefined && (
          <StateMessage
            kind="error"
            title={aiFailureText(loadError, 'Could not load your AIs')}
            action={{ label: 'Retry', onClick: () => reload() }}
          />
        )}

        {ais !== undefined && visible.length === 0 && (
          <StateMessage
            kind="empty"
            icon={Zap}
            title="No AIs yet"
            hint="Create one to give it a chat account and a budget."
            action={{ label: 'New AI', onClick: () => setCreating(true) }}
          />
        )}

        {ais !== undefined && visible.length > 0 && (
          <ul className="overflow-hidden rounded-xl border border-border bg-surface">
            {visible.map((ai) => (
              <AiHealthRow
                key={ai.id}
                ai={ai}
                providerName={providerNames[ai.providerConnectionId]}
                onOpenChat={() => navigate(`/c/${encodeURIComponent(ai.jid)}`)}
                onEdit={() => navigate(`/c/${encodeURIComponent(ai.jid)}?panel=ai`)}
                onDeleted={markRemoved}
              />
            ))}
          </ul>
        )}
      </div>

      {creating && <NewAiDialog onClose={() => setCreating(false)} />}
    </SettingsShell>
  );
}

/** The provider name is decoration on a row, never a reason to fail the page. */
function providerNamesOf(ais: ReadonlyArray<PublicAi>): Effect.Effect<Record<string, string>> {
  if (ais.length === 0) {
    return Effect.succeed<Record<string, string>>({});
  }
  return fromApi(() => listConnections()).pipe(
    Effect.map((connections) => {
      const map: Record<string, string> = {};
      for (const connection of connections) {
        map[connection.id] = providerLabel(connection.provider);
      }
      return map;
    }),
    Effect.orElseSucceed((): Record<string, string> => ({})),
  );
}

class NameSaveFailed extends Data.TaggedError('NameSaveFailed') {}

function NamePage() {
  const navigate = useNavigate();
  const location = useLocation();
  const auth = useAuth();
  const [name, setName] = useState(auth.user?.name ?? '');
  const [emptyName, setEmptyName] = useState(false);
  const [saveState, save] = useAction((trimmed: string) =>
    fromApi(() => updateMe(trimmed)).pipe(
      Effect.andThen(
        Effect.tryPromise({ try: () => auth.refetch(), catch: () => new NameSaveFailed() }),
      ),
      Effect.andThen(
        Effect.try({
          try: () => {
            const next = (location.state as { next?: string } | null)?.next;
            navigate(next === undefined ? '/welcome/handle' : next, { replace: true });
          },
          catch: () => new NameSaveFailed(),
        }),
      ),
    ),
  );
  // A saved name keeps the button off while the redirect happens; a retry hides the old failure.
  const busy = isWaiting(saveState) || AsyncResult.isSuccess(saveState);
  const error = emptyName
    ? 'Enter your name'
    : !isWaiting(saveState) && failureOf(saveState) !== undefined
      ? 'Could not save your name. Try again.'
      : undefined;

  const submit = (event: React.FormEvent): void => {
    event.preventDefault();
    const trimmed = name.trim();
    if (trimmed.length === 0) {
      setEmptyName(true);
      return;
    }
    setEmptyName(false);
    save(trimmed);
  };

  return (
    <div className="chat-background flex min-h-dvh items-center justify-center p-4">
      <form onSubmit={submit} className="w-full max-w-sm rounded-2xl bg-background p-6 shadow-xl">
        <h1 className="text-center text-[24px] leading-8 font-semibold">
          What should we call you?
        </h1>
        <p className="mt-1 text-center text-[15px] text-muted-foreground">
          Your friends will see this name.
        </p>
        <div className="mt-6">
          <TextInput
            id="auth-name"
            label="Name"
            value={name}
            autoFocus
            maxLength={64}
            onChange={(event) => setName(event.target.value)}
            placeholder="Your name"
          />
        </div>
        {error !== undefined && (
          <p role="alert" className="mt-2 text-[14px] text-danger">
            {error}
          </p>
        )}
        <Button type="submit" disabled={busy} size="lg" className="mt-4 w-full">
          Continue
        </Button>
      </form>
    </div>
  );
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
