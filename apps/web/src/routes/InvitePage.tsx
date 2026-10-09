import { Effect } from 'effect';
import { AsyncResult } from 'effect/reactivity';
import { useParams } from 'react-router';
import { AuthFlow } from '@/components/auth/AuthFlow';
import { getInvite } from '@/lib/api';
import { fromApi } from '@/lib/effect/api-effect';
import { useQuery } from '@/lib/effect/use-query';

type InviteState = 'checking' | 'valid' | 'invalid';

// A lookup that fails for any reason is invalid too, so no error text ever
// reaches the page.
const checkInvite = (code: string): Effect.Effect<boolean> =>
  fromApi(() => getInvite(code)).pipe(
    Effect.map((result) => result.valid),
    Effect.catchTag('ApiFailure', () => Effect.succeed(false)),
  );

export function InvitePage() {
  const { code } = useParams<{ code: string }>();
  // A missing code is invalid at once, without a lookup.
  const [lookup] = useQuery(() => (code === undefined ? Effect.never : checkInvite(code)), [code]);
  const state: InviteState =
    code === undefined
      ? 'invalid'
      : AsyncResult.isSuccess(lookup)
        ? lookup.value
          ? 'valid'
          : 'invalid'
        : 'checking';

  if (state === 'checking') {
    return (
      <div className="chat-background flex min-h-dvh items-center justify-center text-[15px] text-muted-foreground">
        Checking your invite…
      </div>
    );
  }

  if (state === 'invalid' || code === undefined) {
    return (
      <div className="chat-background flex min-h-dvh items-center justify-center p-4">
        <div className="w-full max-w-sm rounded-2xl bg-background p-6 text-center shadow-xl">
          <h1 className="text-[24px] leading-8 font-semibold">Invite not valid</h1>
          <p className="mt-2 text-[15px] text-muted-foreground">
            This invite link has expired or was already used. Ask your friend for a new one.
          </p>
        </div>
      </div>
    );
  }

  return <AuthFlow inviteCode={code} heading="You're invited to Zilar" />;
}
