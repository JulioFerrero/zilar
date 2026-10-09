import { Data, Effect } from 'effect';
import { AsyncResult } from 'effect/reactivity';
import { useState } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { useAuth } from '@/auth/AuthProvider';
import { Button } from '@/components/ui/button';
import { TextInput } from '@/components/ui/text-input';
import { ApiError } from '@/lib/api';
import { fromApi } from '@/lib/effect/api-effect';
import { type ApiFailure, toApiFailure } from '@/lib/effect/errors';
import { failureOf, isWaiting, useAction } from '@/lib/effect/use-action';
import { useQuery } from '@/lib/effect/use-query';
import { checkHandle, claimHandle, suggestHandleFor } from '@/lib/handles';
import { dismissHandleGate } from '@/lib/handleGate';

type AvailabilityCheck =
  { state: 'idle' } | { state: 'done'; available: boolean; reason?: string | undefined };

const IDLE_CHECK: AvailabilityCheck = { state: 'idle' };

// The debounce is the 300 ms sleep: useQuery interrupts it when the input
// changes. A rate limit shows its own text; any other failure shows nothing.
const checkAvailability = (handle: string): Effect.Effect<AvailabilityCheck> =>
  handle === ''
    ? Effect.succeed(IDLE_CHECK)
    : Effect.sleep(300).pipe(
        Effect.andThen(fromApi(() => checkHandle(handle))),
        Effect.map((result): AvailabilityCheck => ({
          state: 'done',
          available: result.available,
          reason: result.reason,
        })),
        Effect.catchTag('ApiFailure', (failure) =>
          Effect.succeed(
            failure.code === 'rate_limited'
              ? ({ state: 'done', available: false, reason: 'rate_limited' } as const)
              : IDLE_CHECK,
          ),
        ),
      );

class UsernameMissing extends Data.TaggedError('UsernameMissing') {}
class SaveFailed extends Data.TaggedError('SaveFailed') {}

type ClaimFailure = UsernameMissing | SaveFailed | ApiFailure;

// An ApiError keeps its code and message; anything else thrown is a SaveFailed.
const liftCall = <A,>(call: () => Promise<A>): Effect.Effect<A, ApiFailure | SaveFailed> =>
  Effect.tryPromise({
    try: call,
    catch: (cause) => (cause instanceof ApiError ? toApiFailure(cause) : new SaveFailed()),
  });

/** Onboarding step after the name step: pick a unique `@username`. */
export function HandlePage() {
  const navigate = useNavigate();
  const location = useLocation();
  const auth = useAuth();
  // The suggestion fills when the user arrives (name/email may resolve
  // after mount) while the input is untouched; typing wins forever after.
  const [handle, setHandle] = useState(() =>
    auth.user === undefined ? '' : suggestHandleFor(auth.user.name, auth.user.email),
  );
  const [typed, setTyped] = useState(false);
  const serverUser = auth.user;
  if (!typed && handle === '' && serverUser !== undefined) {
    const suggestion = suggestHandleFor(serverUser.name, serverUser.email);
    if (suggestion !== '') {
      setHandle(suggestion);
    }
  }
  const trimmed = handle.trim();

  // Debounced live availability for the typed handle: the 300 ms sleep is the
  // debounce, and useQuery interrupts it when the input changes.
  const [checkResult] = useQuery(() => checkAvailability(trimmed), [trimmed]);
  const check: AvailabilityCheck = AsyncResult.isSuccess(checkResult)
    ? checkResult.value
    : IDLE_CHECK;

  const next = (location.state as { next?: string } | null)?.next;

  // A second submit while the call waits is dropped (mode 'ignore'). After a
  // success the button stays disabled while the page navigates away.
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
    // "Skip for now" really skips: record the dismissal for this browser
    // session (kept separate from any claim), so the gate does not ask
    // again until the next session. New users in the onboarding flow still
    // reach this step via the name page's chain, not the gate.
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
              <span className="text-danger">{reasonText(check.reason)}</span>
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

function reasonText(reason: string | undefined): string {
  switch (reason) {
    case 'invalid':
      return 'Use 3–32 characters: letters, numbers and _, starting with a letter.';
    case 'reserved':
      return 'That username is reserved. Try another.';
    case 'rate_limited':
      return 'Too many checks — wait a little and try again.';
    default:
      return 'That username is taken. Try another.';
  }
}

function friendlyError(error: ClaimFailure): string {
  switch (error._tag) {
    case 'UsernameMissing':
      return 'Choose a username';
    case 'SaveFailed':
      return 'Could not save your username. Try again.';
    case 'ApiFailure':
      switch (error.code) {
        case 'handle_invalid':
          return 'Use 3–32 characters: letters, numbers and _, starting with a letter.';
        case 'handle_reserved':
          return 'That username is reserved. Try another.';
        case 'handle_taken':
          return 'That username was just taken. Try another.';
        case 'handle_change_too_soon':
          return error.message;
        case 'rate_limited':
          return 'Too many tries — wait a little and try again.';
        default:
          return error.message;
      }
  }
}
