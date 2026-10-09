import { AsyncResult } from 'effect/reactivity';
import { Link } from 'react-router';
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
  // While the status loads, and if it fails, the sign-in form shows.
  const [setupState] = useQuery(() => fromApi(() => getSetupStatus()), []);
  const needsSetup = AsyncResult.isSuccess(setupState) && setupState.value.needsSetup;

  if (needsSetup) {
    return (
      <div className="chat-background flex min-h-dvh items-center justify-center p-4">
        <div className="w-full max-w-sm rounded-2xl bg-background p-6 text-center shadow-xl">
          <img src="/icons/icon-192.png" alt="" width={72} height={72} className="mx-auto mb-3" />
          <h1 className="text-[24px] leading-8 font-semibold">Set up your server</h1>
          <p className="mt-2 text-[15px] text-muted-foreground">
            This server has no accounts yet. Finish the one-time setup to create the first admin.
          </p>
          <Button asChild size="lg" className="mt-5">
            <Link to="/setup">Finish setting up this server</Link>
          </Button>
        </div>
      </div>
    );
  }

  return <AuthFlow heading="Sign in to Zilar" />;
}
