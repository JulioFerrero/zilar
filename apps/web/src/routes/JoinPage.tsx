import { Data, Effect } from 'effect';
import { AsyncResult } from 'effect/reactivity';
import { Link, useNavigate, useParams } from 'react-router';
import { useAuth } from '@/auth/AuthProvider';
import { Button } from '@/components/ui/button';
import { StateMessage } from '@/components/ui/state-message';
import { joinByLink, previewJoinLink, type JoinPreview } from '@/lib/api';
import { fromApi, useDelayed, failureOf, isWaiting } from '@zilar/client-core';
import { useAction } from '@/lib/effect/use-action';
import { useQuery } from '@/lib/effect/use-query';

class OpenFailed extends Data.TaggedError('OpenFailed') {}

// The invite check usually answers in a frame or two; the spinner only shows after 400 ms,
// so a fast link never flashes a checking state.
const INVITE_CHECKING_DELAY_MS = 400;

function JoinChecking() {
  const slow = useDelayed(true, INVITE_CHECKING_DELAY_MS) === true;
  return (
    <div className="chat-background flex min-h-dvh items-center justify-center">
      {slow ? <StateMessage kind="loading" title="Checking your invite link…" /> : null}
    </div>
  );
}

type LoadedPreview =
  | { readonly state: 'ready'; readonly preview: JoinPreview }
  | { readonly state: 'invalid'; readonly preview: undefined };

const loadPreview = (token: string): Effect.Effect<LoadedPreview> =>
  fromApi(() => previewJoinLink(token)).pipe(
    Effect.map((preview): LoadedPreview => ({ state: 'ready', preview })),
    Effect.catchTag('ApiFailure', () =>
      Effect.succeed<LoadedPreview>({ state: 'invalid', preview: undefined }),
    ),
  );

/** Join-by-link page: a preview card and a Join button. A signed-out visitor goes to login
 * with next=/j/<token>. A signed-in user without a name joins only after choosing one, or
 * the group gets a blank member row; then the page opens the group chat. A channel preview
 * counts subscribers and the wording comes from its kind. */
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

  // The preview loads once the session is known and signed in; until then the state stays
  // checking, and a failed preview is invalid.
  const [previewResult] = useQuery(
    () =>
      token === undefined || auth.status !== 'authenticated' ? Effect.never : loadPreview(token),
    [auth.status, token],
  );
  const loaded = AsyncResult.isSuccess(previewResult) ? previewResult.value : undefined;
  const preview = loaded?.preview;

  // Opens the group chat by group id: resolves General from the painted list first, so the
  // new membership had a chance to arrive; falls back to / when it has not.
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
    return <JoinChecking />;
  }

  if (auth.status === 'guest') {
    return (
      <div className="chat-background flex min-h-dvh items-center justify-center p-4">
        <div className="w-full max-w-sm rounded-2xl bg-background p-6 text-center shadow-xl">
          <h1 className="text-[24px] leading-8 font-semibold">You&apos;re invited</h1>
          <p className="mt-2 text-[15px] text-muted-foreground">
            Sign in to see the group and join it.
          </p>
          <Button
            render={<Link to="/login" state={{ from: `/j/${token}` }} />}
            size="lg"
            className="mt-5"
          >
            Sign in
          </Button>
        </div>
      </div>
    );
  }

  // A name is required first, or the join plants a blank member row. The gate is inline, so
  // the loaded preview survives it and the token never leaves the page.
  const needsName = (auth.user?.name ?? '').trim() === '';

  if (state === 'checking') {
    return <JoinChecking />;
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
          <Button
            render={<Link to="/welcome/name" state={{ next: `/j/${token}` }} />}
            size="lg"
            className="mt-5 w-full"
          >
            Choose a name
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
        <Button render={<Link to="/" />} size="lg" className="mt-5">
          Back to chats
        </Button>
      </div>
    </div>
  );
}
