import { AsyncResult } from 'effect/reactivity';
import { Link, Navigate } from 'react-router';
import { useAuth } from '@/auth/AuthProvider';
import { AuthFlow } from '@/components/auth/AuthFlow';
import { Button } from '@/components/ui/button';
import { getSetupStatus } from '@/lib/api';
import { fromApi } from '@/lib/effect/api-effect';
import { useQuery } from '@/lib/effect/use-query';

/**
 * Sign-in, with a detour while the server still needs its first-run
 * setup: a fresh server has no users, so the form would be unusable —
 * show a "Finish setting up this server" link to `/setup` instead.
 */
export function LoginPage() {
  const auth = useAuth();
  // While the status loads, and if it fails, the sign-in form shows.
  const [setupState] = useQuery(() => fromApi(() => getSetupStatus()), []);
  const needsSetup = AsyncResult.isSuccess(setupState) && setupState.value.needsSetup;

  // A signed-in person never sees the form: signing in as someone else needs
  // a sign-out first, as in Telegram (T-1136). While the status loads the form
  // stays, so a session restore does not flash a redirect.
  if (auth.status === 'authenticated') {
    return <Navigate to="/" replace />;
  }

  if (needsSetup) {
    return (
      <div className="chat-background flex min-h-dvh items-center justify-center p-4">
        <div className="w-full max-w-sm rounded-2xl bg-background p-6 text-center shadow-xl">
          <img src="/icons/icon-192.png" alt="" width={72} height={72} className="mx-auto mb-3" />
          <h1 className="text-[24px] leading-8 font-semibold">Set up your server</h1>
          <p className="mt-2 text-[15px] text-muted-foreground">
            This server has no accounts yet. Finish the one-time setup to create the first admin.
          </p>
          <Button render={<Link to="/setup" />} size="lg" className="mt-5">
            Finish setting up this server
          </Button>
        </div>
      </div>
    );
  }

  return <AuthFlow heading="Sign in to Zilar" />;
}
