import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { useAuth } from '@/auth/AuthProvider';
import { ApiError, joinByLink, previewJoinLink, type JoinPreview } from '@/lib/api';

/**
 * Join-by-link page (T-0115): `/j/:token`. Shows a preview card (group
 * title, member count) and a Join button. A signed-out visitor is sent to
 * the login with `next=/j/<token>` and returns here after sign-in; a
 * signed-in user without a display name sees the name gate inline and joins
 * only after choosing a name (joining nameless would plant a blank member
 * row in the group). After joining (or when the preview already reports
 * membership) the page opens the group chat `/c/<groupId>` — the General
 * chat uses the group id. The preview carries `groupId` only for members,
 * so the stranded-join fallback below navigates to `/` when the list has
 * not refreshed yet.
 *
 * T-0124: the same page joins channels ("Join channel" wording comes from
 * `kind` in the preview — see `joinPreviewSchema`); a channel preview
 * counts subscribers.
 *
 * `openGroupChat`/`refreshChats` are injected by the app shell (the route
 * tests pass stubs); the real `AppRoutes` wires the store, which resolves
 * the General chat id from the painted list.
 */
export function JoinPage({
  openGroupChat = async () => undefined,
  refreshChats = () => {},
}: {
  openGroupChat?: (groupId: string) => Promise<string | undefined>;
  refreshChats?: () => void;
}) {
  const { token } = useParams<{ token: string }>();
  const auth = useAuth();
  const navigate = useNavigate();
  const [preview, setPreview] = useState<JoinPreview | undefined>(undefined);
  const [state, setState] = useState<'checking' | 'ready' | 'invalid' | 'full'>('checking');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);

  useEffect(() => {
    if (auth.status === 'loading' || token === undefined) {
      return;
    }
    if (auth.status === 'guest') {
      return;
    }
    // The effect only synchronizes with the session/token (the lint rule
    // flags synchronous setState inside effects); the fetch helper resolves
    // the next state, applied once.
    let active = true;
    void loadPreview(token).then((next) => {
      if (active) {
        setPreview(next.preview);
        setState(next.state);
      }
    });
    return () => {
      active = false;
    };
    async function loadPreview(value: string): Promise<{
      preview: JoinPreview | undefined;
      state: 'ready' | 'invalid';
    }> {
      try {
        return { preview: await previewJoinLink(value), state: 'ready' };
      } catch {
        return { preview: undefined, state: 'invalid' };
      }
    }
  }, [auth.status, token]);

  if (token === undefined) {
    return <JoinCard title="Invite link not valid" body="This link is missing its token." />;
  }

  if (auth.status === 'loading') {
    return (
      <div className="chat-background flex min-h-dvh items-center justify-center text-[15px] text-muted-foreground">
        Checking your invite link…
      </div>
    );
  }

  if (auth.status === 'guest') {
    return (
      <div className="chat-background flex min-h-dvh items-center justify-center p-4">
        <div className="w-full max-w-sm rounded-2xl bg-background p-6 text-center shadow-xl">
          <h1 className="text-[24px] leading-8 font-semibold">You&apos;re invited</h1>
          <p className="mt-2 text-[15px] text-muted-foreground">
            Sign in to see the group and join it.
          </p>
          <Link
            to="/login"
            state={{ from: `/j/${token}` }}
            className="mt-5 inline-block rounded-full bg-accent px-6 py-2 text-[15px] font-medium text-accent-foreground hover:bg-accent/90"
          >
            Sign in
          </Link>
        </div>
      </div>
    );
  }

  // A signed-in user without a display name must pick one before joining:
  // the join would otherwise plant a blank member row in the group. The
  // gate is inline (not a redirect), so the loaded preview survives the
  // name step and the token never leaves the page.
  const needsName = (auth.user?.name ?? '').trim() === '';

  if (state === 'checking') {
    return (
      <div className="chat-background flex min-h-dvh items-center justify-center text-[15px] text-muted-foreground">
        Checking your invite link…
      </div>
    );
  }

  if (state === 'invalid') {
    return (
      <JoinCard
        title="Invite link not valid"
        body="This link is invalid, expired, revoked or already used up. Ask a group admin for a new one."
      />
    );
  }

  if (state === 'full') {
    return (
      <JoinCard
        title="This group is full"
        body="The group reached its member limit, so the link cannot add anyone right now."
      />
    );
  }

  const join = async (): Promise<void> => {
    if (busy || preview === undefined || needsName) {
      return;
    }
    // Opens the group chat for a group id: resolves the General chat (the
    // General chat id is the group id) from the painted list first, so the
    // new membership had a chance to arrive; falls back to `/` when the
    // list has not refreshed yet.
    const openGroup = async (groupId: string): Promise<void> => {
      refreshChats();
      const chatId = await openGroupChat(groupId).catch(() => undefined);
      navigate(chatId === undefined ? '/' : `/c/${encodeURIComponent(chatId)}`, {
        replace: true,
      });
    };
    // Already a member: just open the group.
    if (preview.alreadyMember) {
      if (preview.groupId === undefined) {
        navigate('/', { replace: true });
        return;
      }
      await openGroup(preview.groupId);
      return;
    }
    setBusy(true);
    setError(undefined);
    try {
      const result = await joinByLink(token);
      await openGroup(result.groupId);
    } catch (joinError) {
      if (joinError instanceof ApiError && joinError.code === 'group_full') {
        setState('full');
      } else if (joinError instanceof ApiError && joinError.code === 'invalid_link') {
        setState('invalid');
      } else {
        setError('Could not join the group. Try again.');
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="chat-background flex min-h-dvh items-center justify-center p-4">
      <div className="w-full max-w-sm rounded-2xl bg-background p-6 text-center shadow-xl">
        <h1 className="text-[24px] leading-8 font-semibold">{preview?.groupTitle ?? 'Group'}</h1>
        <p className="mt-2 text-[15px] text-muted-foreground">
          {preview?.memberCount ?? 0}{' '}
          {preview?.kind === 'channel'
            ? (preview?.memberCount ?? 0) === 1
              ? 'subscriber'
              : 'subscribers'
            : (preview?.memberCount ?? 0) === 1
              ? 'member'
              : 'members'}
        </p>
        {preview?.alreadyMember === true ? (
          <p className="mt-2 text-[14px] text-muted-foreground">
            You&apos;re already a member of this {preview?.kind === 'channel' ? 'channel' : 'group'}
            .
          </p>
        ) : null}
        {needsName ? (
          <p className="mt-3 text-[14px] text-muted-foreground">
            Choose a display name first — your new group will see it.
          </p>
        ) : null}
        {error !== undefined && (
          <p role="alert" className="mt-3 text-[14px] text-danger">
            {error}
          </p>
        )}
        {needsName ? (
          <Link
            to="/welcome/name"
            state={{ next: `/j/${token}` }}
            className="mt-5 inline-block w-full rounded-full bg-accent px-4 py-2.5 text-[15px] font-medium text-accent-foreground hover:bg-accent/90"
          >
            Choose a name
          </Link>
        ) : (
          <button
            type="button"
            disabled={busy}
            onClick={() => void join()}
            className="mt-5 w-full rounded-full bg-accent px-4 py-2.5 text-[15px] font-medium text-accent-foreground hover:bg-accent/90 disabled:opacity-60"
          >
            {busy
              ? 'Joining…'
              : preview?.alreadyMember === true
                ? `Open the ${preview?.kind === 'channel' ? 'channel' : 'group'}`
                : preview?.kind === 'channel'
                  ? 'Join the channel'
                  : 'Join the group'}
          </button>
        )}
      </div>
    </div>
  );
}

function JoinCard({ title, body }: { title: string; body: string }) {
  return (
    <div className="chat-background flex min-h-dvh items-center justify-center p-4">
      <div className="w-full max-w-sm rounded-2xl bg-background p-6 text-center shadow-xl">
        <h1 className="text-[24px] leading-8 font-semibold">{title}</h1>
        <p className="mt-2 text-[15px] text-muted-foreground">{body}</p>
        <Link
          to="/"
          className="mt-5 inline-block rounded-full bg-accent px-6 py-2 text-[15px] font-medium text-accent-foreground hover:bg-accent/90"
        >
          Back to chats
        </Link>
      </div>
    </div>
  );
}
