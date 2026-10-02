import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { AuthFlow } from '@/components/auth/AuthFlow';
import { getSetupStatus } from '@/lib/api';

/**
 * Sign-in, with a detour while the server still needs its first-run
 * setup: a fresh server has no users, so the form would be unusable —
 * show a "Finish setting up this server" link to `/setup` instead.
 */
export function LoginPage() {
  const [needsSetup, setNeedsSetup] = useState(false);

  useEffect(() => {
    let active = true;
    getSetupStatus()
      .then((status) => {
        if (active) {
          setNeedsSetup(status.needsSetup);
        }
      })
      .catch(() => {
        if (active) {
          setNeedsSetup(false);
        }
      });
    return () => {
      active = false;
    };
  }, []);

  if (needsSetup) {
    return (
      <div className="chat-background flex min-h-dvh items-center justify-center p-4">
        <div className="w-full max-w-sm rounded-2xl bg-background p-6 text-center shadow-xl">
          <img src="/icons/icon-192.png" alt="" width={72} height={72} className="mx-auto mb-3" />
          <h1 className="text-[24px] leading-8 font-semibold">Set up your server</h1>
          <p className="mt-2 text-[15px] text-muted-foreground">
            This server has no accounts yet. Finish the one-time setup to create the first admin.
          </p>
          <Link
            to="/setup"
            className="mt-5 inline-block rounded-full bg-accent px-5 py-2.5 text-[15px] font-medium text-accent-foreground hover:bg-accent/90"
          >
            Finish setting up this server
          </Link>
        </div>
      </div>
    );
  }

  return <AuthFlow heading="Sign in to Zilar" />;
}
