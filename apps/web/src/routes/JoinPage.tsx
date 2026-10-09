import { Data, Effect } from 'effect';
import { AsyncResult } from 'effect/reactivity';
import { Link, useNavigate, useParams } from 'react-router';
import { useAuth } from '@/auth/AuthProvider';
import { Button } from '@/components/ui/button';
import { joinByLink, previewJoinLink, type JoinPreview } from '@/lib/api';
import { fromApi } from '@/lib/effect/api-effect';
import { failureOf, isWaiting, useAction } from '@/lib/effect/use-action';
import { useQuery } from '@/lib/effect/use-query';

class OpenFailed extends Data.TaggedError('OpenFailed') {}

type LoadedPreview =
  | { readonly state: 'ready'; readonly preview: JoinPreview }
  | { readonly state: 'invalid'; readonly preview: undefined };

// Any failure of the preview call means the link is not valid.
const loadPreview = (token: string): Effect.Effect<LoadedPreview> =>
  fromApi(() => previewJoinLink(token)).pipe(
    Effect.map((preview): LoadedPreview => ({ state: 'ready', preview })),
    Effect.catchTag('ApiFailure', () =>
      Effect.succeed<LoadedPreview>({ state: 'invalid', preview: undefined }),
    ),
  );

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
  openGroupChat = () => Promise.resolve(undefined),
  refreshChats = () => {},
}: {
  openGroupChat?: (groupId: string) => Promise<string | undefined>;
  refreshChats?: () => void;
}) {
  const { token } = useParams<{ token: string }>();
  const auth = useAuth();
  const navigate = useNavigate();

  // The preview loads once the session is known and signed in. Until then
  // (and for a guest, who sees the sign-in card) the query never answers, so
  // the state stays 'checking'. A failed preview is 'invalid'.
  const [previewResult] = useQuery(
    () =>
      token === undefined || auth.status !== 'authenticated' ? Effect.never : loadPreview(token),
    [auth.status, token],
  );
  const loaded = AsyncResult.isSuccess(previewResult) ? previewResult.value : undefined;
  const preview = loaded?.preview;

  // Opens the group chat for a group id: resolves the General chat (the
  // General chat id is the group id) from the painted list first, so the
  // new membership had a chance to arrive; falls back to `/` when the
  // list has not refreshed yet.
  const openGroupEffect = (groupId: string): Effect.Effect<void, OpenFailed> =>
    Effect.try({ try: refreshChats, catch: () => new OpenFailed() }).pipe(
      Effect.andThen(
        Effect.tryPromise({ try: () => openGroupChat(groupId), catch: () => undefined }).pipe(
          Effect.orElseSucceed(() => undefined),
        ),
      ),
      Effect.andThen((chatId) =>
        Effect.sync(() =>
          navigate(chatId === undefined ? '/' : `/c/${encodeURIComponent(chatId)}`, {
            replace: true,
          }),
        ),
      ),
    );

  // "Already a member" opens the group without touching the Join state.
  const [, openGroup] = useAction((groupId: string) => openGroupEffect(groupId));
  const [joinState, runJoin] = useAction((joinToken: string) =>
    fromApi(() => joinByLink(joinToken)).pipe(
      Effect.andThen((result) => openGroupEffect(result.groupId)),
    ),
  );
  const busy = isWaiting(joinState);
  const joinFailure = busy ? undefined : failureOf(joinState);
  const refusal = joinFailure?._tag === 'ApiFailure' ? joinFailure.code : undefined;
  const state: 'checking' | 'ready' | 'invalid' | 'full' =
    refusal === 'group_full'
      ? 'full'
      : refusal === 'invalid_link'
        ? 'invalid'
        : (loaded?.state ?? 'checking');
  const error =
    joinFailure !== undefined && refusal !== 'group_full' && refusal !== 'invalid_link'
      ? 'Could not join the group. Try again.'
      : undefined;

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
          <Button asChild size="lg" className="mt-5">
            <Link to="/login" state={{ from: `/j/${token}` }}>
              Sign in
            </Link>
          </Button>
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

  const join = (): void => {
    if (busy || preview === undefined || needsName) {
      return;
    }
    // Already a member: just open the group.
    if (preview.alreadyMember) {
      if (preview.groupId === undefined) {
        navigate('/', { replace: true });
        return;
      }
      openGroup(preview.groupId);
      return;
    }
    runJoin(token);
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
          <Button asChild size="lg" className="mt-5 w-full">
            <Link to="/welcome/name" state={{ next: `/j/${token}` }}>
              Choose a name
            </Link>
          </Button>
        ) : (
          <Button type="button" disabled={busy} onClick={join} size="lg" className="mt-5 w-full">
            {busy
              ? 'Joining…'
              : preview?.alreadyMember === true
                ? `Open the ${preview?.kind === 'channel' ? 'channel' : 'group'}`
                : preview?.kind === 'channel'
                  ? 'Join the channel'
                  : 'Join the group'}
          </Button>
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
        <Button asChild size="lg" className="mt-5">
          <Link to="/">Back to chats</Link>
        </Button>
      </div>
    </div>
  );
}
