import { Button } from './ui/button';
import { useClientVersionCheck } from '@/lib/useClientVersionCheck';

/** A thin bar when this build is older than the server's minimum protocol, or after a deploy; it never blocks the app. */
export function ClientVersionBanner({ reason }: { reason?: 'deploy' | undefined } = {}) {
  const outdated = useClientVersionCheck();

  if (!outdated && reason !== 'deploy') {
    return null;
  }

  return (
    <div
      role="status"
      className="fixed inset-x-0 top-0 z-50 border-b border-border bg-accent px-3 py-1.5 text-accent-foreground"
    >
      <div className="mx-auto flex w-full max-w-[860px] items-center justify-center gap-3">
        <span className="text-[13px]">A new version is available.</span>
        <Button type="button" variant="outline" size="sm" onClick={() => window.location.reload()}>
          Reload
        </Button>
      </div>
    </div>
  );
}
