import { useEffect, useState } from 'react';
import { useParams } from 'react-router';
import { AuthFlow } from '@/components/auth/AuthFlow';
import { getInvite } from '@/lib/api';

export function InvitePage() {
  const { code } = useParams<{ code: string }>();
  const [state, setState] = useState<'checking' | 'valid' | 'invalid'>(
    code === undefined ? 'invalid' : 'checking',
  );

  useEffect(() => {
    if (code === undefined) {
      return;
    }
    let active = true;
    getInvite(code)
      .then((result) => {
        if (active) {
          setState(result.valid ? 'valid' : 'invalid');
        }
      })
      .catch(() => {
        if (active) {
          setState('invalid');
        }
      });
    return () => {
      active = false;
    };
  }, [code]);

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

  return <AuthFlow inviteCode={code} heading="You're invited to Galena" />;
}
