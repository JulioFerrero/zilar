import { Data, Effect } from 'effect';
import { AsyncResult } from 'effect/reactivity';
import { useState } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { useAuth } from '@/auth/AuthProvider';
import { Button } from '@/components/ui/button';
import { TextInput } from '@/components/ui/text-input';
import {
  ApiError,
  checkHandle as apiCheckHandle,
  claimHandle as apiClaimHandle,
  type HandleCheck,
} from '@/lib/api';
import { type ApiFailure, toApiFailure, failureOf, isWaiting } from '@zilar/client-core';
import { suggestHandle } from '@zilar/protocol';
import { useAction } from '@/lib/effect/use-action';
import { useQuery } from '@/lib/effect/use-query';
import { dismissHandleGate } from '@/lib/handleGate';
import {
  checkHandleAvailability,
  handleReasonText,
  handleSaveError,
  IDLE_AVAILABILITY,
  type HandleAvailability,
} from '@/components/settings/handleField';

// Shared with the server, which is the authority.

// Passed through unchanged: HandlePage matches ApiError with instanceof, which fromApi would replace.
const passThrough = <A,>(call: () => Promise<A>): Promise<A> =>
  Effect.runPromise(
    Effect.tryPromise({
      try: call,
      catch: (cause) => cause,
    }),
  );

function checkHandle(handle: string): Promise<HandleCheck> {
  return passThrough(() => apiCheckHandle(handle));
}

function claimHandle(handle: string): Promise<{ handle: string }> {
  return passThrough(() => apiClaimHandle(handle));
}

const checkAvailability = (handle: string): Effect.Effect<HandleAvailability> =>
  checkHandleAvailability(handle, checkHandle);

class UsernameMissing extends Data.TaggedError('UsernameMissing') {}
class SaveFailed extends Data.TaggedError('SaveFailed') {}

type ClaimFailure = UsernameMissing | SaveFailed | ApiFailure;

const liftCall = <A,>(call: () => Promise<A>): Effect.Effect<A, ApiFailure | SaveFailed> =>
  Effect.tryPromise({
    try: call,
    catch: (cause) => (cause instanceof ApiError ? toApiFailure(cause) : new SaveFailed()),
  });

export function HandlePage() {
  const navigate = useNavigate();
  const location = useLocation();
  const auth = useAuth();
  // The suggestion fills while the input is untouched; typing wins forever after.
  const [handle, setHandle] = useState(() =>
    auth.user === undefined ? '' : suggestHandle(auth.user.name, auth.user.email),
  );
  const [typed, setTyped] = useState(false);
  const serverUser = auth.user;
  if (!typed && handle === '' && serverUser !== undefined) {
    const suggestion = suggestHandle(serverUser.name, serverUser.email);
    if (suggestion !== '') {
      setHandle(suggestion);
    }
  }
  const trimmed = handle.trim();

  // Debounced live availability: the 300 ms sleep is the debounce, interrupted on a new input.
  const [checkResult] = useQuery(() => checkAvailability(trimmed), [trimmed]);
  const check: HandleAvailability = AsyncResult.isSuccess(checkResult)
    ? checkResult.value
    : IDLE_AVAILABILITY;

  const next = (location.state as { next?: string } | null)?.next;

  // A second submit while the call waits is dropped; after success the button stays disabled.
  const [claimState, runClaim] = useAction<void, void, ClaimFailure>(
    (): Effect.Effect<void, ClaimFailure> =>
      trimmed === ''
        ? Effect.fail(new UsernameMissing())
        : liftCall(() => claimHandle(trimmed)).pipe(
            Effect.andThen(liftCall(() => auth.refetch())),
            Effect.andThen(Effect.sync(() => navigate(next ?? '/', { replace: true }))),
          ),
  );
  const busy = isWaiting(claimState) || AsyncResult.isSuccess(claimState);
  const claimFailure = isWaiting(claimState) ? undefined : failureOf(claimState);
  const error = claimFailure === undefined ? undefined : friendlyError(claimFailure);

  const submit = (event: React.FormEvent): void => {
    event.preventDefault();
    runClaim();
  };

  const skip = (): void => {
    // Skip records the dismissal for this browser session, so the gate does not ask again;
    // new users still reach this step through the name page's chain, not the gate.
    if (auth.user !== undefined) {
      dismissHandleGate(auth.user.id);
    }
    navigate(next ?? '/', { replace: true });
  };

  return (
    <div className="chat-background flex min-h-dvh items-center justify-center p-4">
      <form onSubmit={submit} className="w-full max-w-sm rounded-2xl bg-background p-6 shadow-xl">
        <h1 className="text-center text-[24px] leading-8 font-semibold">Pick your username</h1>
        <p className="mt-1 text-center text-[15px] text-muted-foreground">
          Friends add you with it, like @ada. You can change it later.
        </p>
        <div className="mt-6">
          <TextInput
            id="auth-handle"
            label="Username"
            value={handle}
            autoFocus
            maxLength={32}
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            onChange={(event) => {
              setHandle(event.target.value);
              setTyped(true);
            }}
            placeholder="ada_lovelace"
          />
        </div>
        <div aria-live="polite" className="mt-2 min-h-[20px] text-[14px]">
          {check.state === 'done' &&
            (check.available ? (
              <span className="text-muted-foreground">@{trimmed} is available</span>
            ) : (
              <span className="text-danger">{handleReasonText(check.reason, 'username')}</span>
            ))}
        </div>
        {error !== undefined && (
          <p role="alert" className="mt-2 text-[14px] text-danger">
            {error}
          </p>
        )}
        <Button type="submit" disabled={busy} size="lg" className="mt-4 w-full">
          Continue
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="lg"
          onClick={skip}
          className="mt-2 w-full text-muted-foreground"
        >
          Skip for now
        </Button>
      </form>
    </div>
  );
}

function friendlyError(error: ClaimFailure): string {
  switch (error._tag) {
    case 'UsernameMissing':
      return 'Choose a username';
    case 'SaveFailed':
      return 'Could not save your username. Try again.';
    case 'ApiFailure':
      return handleSaveError(error, 'username') ?? error.message;
  }
}
