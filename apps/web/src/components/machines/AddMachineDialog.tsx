import { useEffect, useState } from 'react';
import { Check, Copy } from 'lucide-react';
import { createPairingCode, type PairingCode } from '@/lib/api';
import { copyText } from '@/lib/clipboard';
import { machineErrorMessage } from './errors';
import { FieldError } from '@/components/ais/AiPageShell';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';

type DialogStatus = 'loading' | 'ready' | 'expired' | 'error';

const EXPIRED_ANNOUNCE = 'Code expired';

/**
 * The "Add machine" dialog: mints a fresh pairing code, shows it big in Geist
 * Mono with a copy key, a live countdown, and the `zilar-runner pair <CODE>`
 * command. The desktop runner is not published yet, so the line below the
 * command says so honestly.
 */
export function AddMachineDialog({ onClose }: { onClose: () => void }) {
  const [status, setStatus] = useState<DialogStatus>('loading');
  const [pairing, setPairing] = useState<PairingCode | null>(null);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);
  const [remainingMs, setRemainingMs] = useState(0);
  const [announcement, setAnnouncement] = useState('');

  useEffect(() => {
    let active = true;
    createPairingCode()
      .then((next) => {
        if (!active) {
          return;
        }
        setPairing(next);
        setRemainingMs(new Date(next.expiresAt).getTime() - Date.now());
        setStatus('ready');
      })
      .catch((cause: unknown) => {
        if (!active) {
          return;
        }
        setError(machineErrorMessage(cause, 'Could not create a pairing code.'));
        setStatus('error');
      });
    return () => {
      active = false;
    };
  }, []);

  // The countdown ticks each second; stops at zero. No fake-timer shortcuts.
  useEffect(() => {
    if (status !== 'ready') {
      return undefined;
    }
    const id = window.setInterval(() => {
      if (pairing === null) {
        return;
      }
      const left = new Date(pairing.expiresAt).getTime() - Date.now();
      if (left <= 0) {
        setRemainingMs(0);
        setStatus('expired');
        setAnnouncement(EXPIRED_ANNOUNCE);
        window.clearInterval(id);
      } else {
        setRemainingMs(left);
      }
    }, 1000);
    return () => window.clearInterval(id);
  }, [status, pairing]);

  const copy = (): void => {
    if (pairing === null) {
      return;
    }
    void copyText(pairing.code).then(() => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    });
  };

  const refresh = (): void => {
    setStatus('loading');
    setError('');
    setPairing(null);
    setCopied(false);
    setAnnouncement('');
    createPairingCode()
      .then((next) => {
        setPairing(next);
        setRemainingMs(new Date(next.expiresAt).getTime() - Date.now());
        setStatus('ready');
      })
      .catch((cause: unknown) => {
        setError(machineErrorMessage(cause, 'Could not create a pairing code.'));
        setStatus('error');
      });
  };

  const actions =
    status === 'error' ? (
      <>
        <button
          type="button"
          onClick={onClose}
          className="rounded-full px-4 py-1.5 text-[15px] text-muted-foreground hover:bg-list-hover"
        >
          Close
        </button>
        <Button type="button" onClick={refresh} size="lg">
          Try again
        </Button>
      </>
    ) : (status === 'ready' || status === 'expired') && pairing !== null ? (
      <>
        {status === 'expired' ? (
          <Button type="button" onClick={refresh} size="lg">
            New code
          </Button>
        ) : null}
        <Button type="button" onClick={onClose} size="lg">
          Done
        </Button>
      </>
    ) : undefined;

  return (
    <Dialog
      open
      onClose={onClose}
      title="Add machine"
      description="Pair a new computer where your AIs can work."
      size="sm"
      {...(actions === undefined ? {} : { actions })}
    >
      {status === 'loading' && (
        <p className="mt-4 text-[14px] text-muted-foreground">Creating code…</p>
      )}

      {status === 'error' && <FieldError>{error}</FieldError>}

      {(status === 'ready' || status === 'expired') && pairing !== null && (
        <>
          <div className="mt-4 rounded-xl border border-divider bg-well">
            <p
              aria-live="off"
              className="px-4 py-3 text-center font-mono text-[28px] font-semibold tracking-[0.1em]"
            >
              {pairing.code}
            </p>
            <div className="flex items-center justify-between gap-2 border-t border-divider px-3 py-2">
              <p
                role="timer"
                aria-live="off"
                className={cn(
                  'font-mono text-[12px]',
                  status === 'expired' ? 'text-danger' : 'text-muted-foreground',
                )}
              >
                <span aria-hidden="true">
                  {status === 'expired'
                    ? 'Code expired'
                    : `Expires in ${formatRemaining(remainingMs)}`}
                </span>
              </p>
              <Button
                type="button"
                aria-label="Copy pairing code"
                title="Copy pairing code"
                disabled={status === 'expired'}
                onClick={copy}
                size="sm"
              >
                {copied ? (
                  <Check className="size-4" aria-hidden="true" />
                ) : (
                  <Copy className="size-4" aria-hidden="true" />
                )}
                {copied ? 'Copied' : 'Copy'}
              </Button>
            </div>
          </div>

          <p className="mt-3 text-[14px]">
            On the machine, download the runner app, then run{' '}
            <span className="font-mono text-[13px] whitespace-nowrap">
              zilar-runner pair {pairing.code}
            </span>
          </p>
          <p className="mt-1 text-[13px] text-muted-foreground">
            The desktop runner is not published yet — this code is ready for when it is.
          </p>

          {/* Visually hidden so AT users hear the expiry once. */}
          <p role="status" aria-live="polite" className="sr-only">
            {announcement}
          </p>
        </>
      )}
    </Dialog>
  );
}

function formatRemaining(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}
